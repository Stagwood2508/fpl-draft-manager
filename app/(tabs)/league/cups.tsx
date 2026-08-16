import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import LivePlayerBreakdownModal, { LivePlayerScore } from '@/components/LivePlayerBreakdownModal';
import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

interface CupSummary {
  id: string;
  name: string;
  status: 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  start_gameweek: number;
  round_count: number;
  participant_count: number;
  champion_user_id: string | null;
  runner_up_user_id: string | null;
  created_at: string;
}

interface CupBoardRow {
  cup_id: string;
  cup_name: string;
  cup_status: string;
  round_id: string;
  round_number: number;
  round_name: string;
  gameweek: number;
  round_status: string;
  fixture_id: string | null;
  match_number: number | null;
  fixture_status: string | null;
  home_user_id: string | null;
  home_team_name: string;
  home_score: number;
  home_fpl_points: number;
  home_defcon_points: number;
  away_user_id: string | null;
  away_team_name: string;
  away_score: number;
  away_fpl_points: number;
  away_defcon_points: number;
  winner_user_id: string | null;
  resolution: string | null;
}

interface GameweekState {
  deadline: number;
  finished: boolean;
}

const POSITION_ORDER: Record<string, number> = {
  GKP: 1, GK: 1, '1': 1, DEF: 2, '2': 2, MID: 3, '3': 3, FWD: 4, '4': 4,
};

const statusLabel = (status: string) => {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'LIVE') return 'IN PROGRESS';
  if (status === 'CANCELLED') return 'CANCELLED';
  return 'SCHEDULED';
};

const resolutionLabel = (resolution: string | null) => {
  const labels: Record<string, string> = {
    TOTAL_SCORE: 'Total score',
    HIGHEST_STARTER: 'Highest-scoring player',
    MOST_GOALS: 'Most goals',
    MOST_ASSISTS: 'Most assists',
    HIGHER_SEED: 'Higher seed',
    BYE: 'Bye',
  };
  return resolution ? labels[resolution] || resolution : '';
};

export default function CupsScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { activeLeagueId, currentUserId } = useAppSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [cups, setCups] = useState<CupSummary[]>([]);
  const [board, setBoard] = useState<CupBoardRow[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [gameweeks, setGameweeks] = useState<Record<number, GameweekState>>({});
  const [selectedCupId, setSelectedCupId] = useState<string | null>(null);
  const [selectedFixture, setSelectedFixture] = useState<CupBoardRow | null>(null);
  const [fixturePlayers, setFixturePlayers] = useState<{ home: LivePlayerScore[]; away: LivePlayerScore[] }>({ home: [], away: [] });
  const [activeSide, setActiveSide] = useState<'HOME' | 'AWAY'>('HOME');
  const [playersLoading, setPlayersLoading] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<LivePlayerScore | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCups = useCallback(async (background = false) => {
    if (!activeLeagueId || !currentUserId) {
      setLoading(false);
      return;
    }
    try {
      if (!background) setLoading(true);
      setErrorMessage(null);
      const [cupsResult, boardResult, leagueResult, membersResult, gameweeksResult] = await Promise.all([
        supabase
          .from('cups')
          .select('id, name, status, start_gameweek, round_count, participant_count, champion_user_id, runner_up_user_id, created_at')
          .eq('league_id', activeLeagueId)
          .order('created_at', { ascending: false }),
        supabase.rpc('get_cup_fixture_board', { p_league_id: activeLeagueId }),
        supabase.from('leagues').select('commissioner_id').eq('id', activeLeagueId).single(),
        supabase.from('league_members').select('user_id, team_name').eq('league_id', activeLeagueId),
        supabase.from('league_gameweeks').select('gameweek, gw_deadline, is_finished').eq('league_id', activeLeagueId),
      ]);
      if (cupsResult.error) throw cupsResult.error;
      if (boardResult.error) throw boardResult.error;
      if (leagueResult.error) throw leagueResult.error;
      if (membersResult.error) throw membersResult.error;
      if (gameweeksResult.error) throw gameweeksResult.error;

      const nextCups = (cupsResult.data || []) as CupSummary[];
      setCups(nextCups);
      setBoard((boardResult.data || []) as CupBoardRow[]);
      setIsCommissioner(leagueResult.data?.commissioner_id === currentUserId);
      setTeamNames(Object.fromEntries((membersResult.data || []).map((member: any) => [
        String(member.user_id), member.team_name || 'Unnamed team',
      ])));
      setGameweeks(Object.fromEntries((gameweeksResult.data || []).map((gameweek: any) => [
        Number(gameweek.gameweek),
        { deadline: new Date(gameweek.gw_deadline).getTime(), finished: Boolean(gameweek.is_finished) },
      ])));
      setSelectedCupId(current => (
        current && nextCups.some(cup => cup.id === current) ? current : nextCups[0]?.id || null
      ));
    } catch (error: any) {
      setErrorMessage(error?.message || 'Cup competitions could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeLeagueId, currentUserId]);

  useFocusEffect(useCallback(() => {
    void loadCups();
  }, [loadCups]));

  useEffect(() => {
    const timer = setInterval(() => void loadCups(true), 60_000);
    return () => clearInterval(timer);
  }, [loadCups]);

  const selectedCup = cups.find(cup => cup.id === selectedCupId) || null;
  const selectedBoard = board.filter(row => row.cup_id === selectedCupId);
  const rounds = useMemo(() => {
    const grouped = new Map<string, { id: string; number: number; name: string; gameweek: number; fixtures: CupBoardRow[] }>();
    selectedBoard.forEach(row => {
      const current = grouped.get(row.round_id) || {
        id: row.round_id,
        number: row.round_number,
        name: row.round_name,
        gameweek: row.gameweek,
        fixtures: [],
      };
      if (row.fixture_id) current.fixtures.push(row);
      grouped.set(row.round_id, current);
    });
    return Array.from(grouped.values()).sort((a, b) => a.number - b.number);
  }, [selectedBoard]);

  const openFixture = async (fixture: CupBoardRow) => {
    if (!activeLeagueId || !fixture.home_user_id || !fixture.away_user_id) return;
    setSelectedFixture(fixture);
    setActiveSide('HOME');
    setFixturePlayers({ home: [], away: [] });
    try {
      setPlayersLoading(true);
      const { data, error } = await supabase.rpc('get_league_gameweek_player_scores', {
        p_league_id: activeLeagueId,
        p_gameweek: fixture.gameweek,
      });
      if (error) throw error;
      const sortPlayers = (a: LivePlayerScore, b: LivePlayerScore) => (
        (POSITION_ORDER[a.position] || 99) - (POSITION_ORDER[b.position] || 99)
        || a.player_name.localeCompare(b.player_name)
      );
      const players = (data || []) as LivePlayerScore[];
      setFixturePlayers({
        home: players.filter((player: any) => player.user_id === fixture.home_user_id).sort(sortPlayers),
        away: players.filter((player: any) => player.user_id === fixture.away_user_id).sort(sortPlayers),
      });
    } catch (error: any) {
      setErrorMessage(error?.message || 'The cup lineup breakdown could not be loaded.');
    } finally {
      setPlayersLoading(false);
    }
  };

  if (loading && cups.length === 0) {
    return <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadCups(true); }} tintColor={colors.accent} />}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>LEAGUE CUPS</Text>
            <Text style={styles.title}>Cup competitions</Text>
            <Text style={styles.subtitle}>Live brackets powered by your official Gameweek lineup.</Text>
          </View>
          {isCommissioner && (
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => router.push({ pathname: '/(admin)/cup-wizard', params: { leagueId: activeLeagueId || '' } })}
            >
              <Ionicons name="add" size={18} color={colors.backgroundDeep} />
              <Text style={styles.createButtonText}>CREATE CUP</Text>
            </TouchableOpacity>
          )}
        </View>

        {errorMessage && (
          <TouchableOpacity style={styles.errorBanner} onPress={() => void loadCups()}>
            <Ionicons name="warning-outline" size={17} color={colors.danger} />
            <Text style={styles.errorText}>{errorMessage} Tap to retry.</Text>
          </TouchableOpacity>
        )}

        {cups.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="trophy-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No cups created yet</Text>
            <Text style={styles.emptyText}>The commissioner can create a knockout competition for all or selected managers.</Text>
            {isCommissioner && (
              <TouchableOpacity style={styles.emptyAction} onPress={() => router.push('/(admin)/cup-wizard')}>
                <Text style={styles.emptyActionText}>CREATE THE FIRST CUP</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cupPicker}>
              {cups.map(cup => (
                <TouchableOpacity
                  key={cup.id}
                  style={[styles.cupPill, selectedCupId === cup.id && styles.cupPillActive]}
                  onPress={() => setSelectedCupId(cup.id)}
                >
                  <Ionicons name="trophy" size={14} color={selectedCupId === cup.id ? colors.backgroundDeep : colors.accent} />
                  <Text style={[styles.cupPillText, selectedCupId === cup.id && styles.cupPillTextActive]} numberOfLines={1}>{cup.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {selectedCup && (
              <View style={styles.cupHero}>
                <View style={styles.cupHeroTop}>
                  <View style={styles.trophyIcon}><Ionicons name="trophy" size={22} color={colors.accent} /></View>
                  <View style={styles.cupHeroCopy}>
                    <Text style={styles.cupName}>{selectedCup.name}</Text>
                    <Text style={styles.cupMeta}>{selectedCup.participant_count} entrants · {selectedCup.round_count} rounds · starts GW{selectedCup.start_gameweek}</Text>
                  </View>
                  <View style={[styles.statusBadge, selectedCup.status === 'COMPLETED' && styles.statusBadgeComplete]}>
                    <Text style={styles.statusBadgeText}>{statusLabel(selectedCup.status)}</Text>
                  </View>
                </View>
                {selectedCup.status === 'COMPLETED' && selectedCup.champion_user_id && (
                  <View style={styles.championStrip}>
                    <Text style={styles.championLabel}>CHAMPION</Text>
                    <Text style={styles.championName}>{teamNames[selectedCup.champion_user_id] || 'Cup winner'}</Text>
                  </View>
                )}
              </View>
            )}

            <View style={styles.bracketHeading}>
              <View>
                <Text style={styles.sectionLabel}>TOURNAMENT BRACKET</Text>
                <Text style={styles.bracketHint}>Scroll sideways to follow the route to the final.</Text>
              </View>
              <Ionicons name="swap-horizontal" size={18} color={colors.textMuted} />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bracketScroll}>
              {rounds.map(round => (
                <View key={round.id} style={styles.roundColumn}>
                  <View style={styles.roundHeader}>
                    <Text style={styles.roundName}>{round.name}</Text>
                    <Text style={styles.roundGameweek}>GW{round.gameweek}</Text>
                  </View>
                  <View style={styles.roundFixtures}>
                    {round.fixtures.length === 0 ? (
                      <View style={styles.pendingFixture}>
                        <Ionicons name="lock-closed-outline" size={15} color={colors.textMuted} />
                        <Text style={styles.pendingFixtureText}>Draw confirmed after the previous round</Text>
                      </View>
                    ) : round.fixtures.map(fixture => {
                      const gameweek = gameweeks[fixture.gameweek];
                      const hasStarted = fixture.fixture_status === 'COMPLETED'
                        || fixture.fixture_status === 'BYE'
                        || Boolean(gameweek && gameweek.deadline <= Date.now());
                      const showScore = hasStarted && fixture.fixture_status !== 'BYE';
                      const homeWon = fixture.winner_user_id === fixture.home_user_id;
                      const awayWon = fixture.winner_user_id === fixture.away_user_id;
                      return (
                        <TouchableOpacity
                          key={fixture.fixture_id || `${round.id}-${fixture.match_number}`}
                          style={[styles.fixtureCard, fixture.fixture_status === 'BYE' && styles.byeCard]}
                          onPress={() => void openFixture(fixture)}
                          disabled={!fixture.away_user_id}
                        >
                          <View style={styles.fixtureTopLine}>
                            <Text style={styles.matchNumber}>MATCH {fixture.match_number}</Text>
                            <Text style={styles.fixtureState}>{fixture.fixture_status === 'COMPLETED' ? 'FT' : fixture.fixture_status === 'BYE' ? 'BYE' : hasStarted ? 'LIVE' : `GW${fixture.gameweek}`}</Text>
                          </View>
                          <View style={[styles.teamRow, homeWon && styles.winnerRow]}>
                            <Text style={[styles.teamName, homeWon && styles.winnerText]} numberOfLines={1}>{fixture.home_team_name}</Text>
                            <Text style={styles.teamScore}>{showScore ? fixture.home_score : '—'}</Text>
                          </View>
                          <View style={[styles.teamRow, awayWon && styles.winnerRow]}>
                            <Text style={[styles.teamName, awayWon && styles.winnerText]} numberOfLines={1}>{fixture.away_team_name}</Text>
                            <Text style={styles.teamScore}>{showScore ? fixture.away_score : '—'}</Text>
                          </View>
                          {fixture.resolution && fixture.fixture_status === 'COMPLETED' && (
                            <Text style={styles.resolutionText}>Decided by {resolutionLabel(fixture.resolution).toLowerCase()}</Text>
                          )}
                          {fixture.away_user_id && <Text style={styles.openHint}>Tap for starting XI breakdown</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
          </>
        )}
      </ScrollView>

      <Modal visible={Boolean(selectedFixture)} transparent animationType="slide" onRequestClose={() => setSelectedFixture(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalEyebrow}>{selectedFixture?.round_name} · GW{selectedFixture?.gameweek}</Text>
                <Text style={styles.modalTitle}>Cup fixture breakdown</Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={() => setSelectedFixture(null)}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            {selectedFixture && (
              <View style={styles.teamTabs}>
                {([
                  { side: 'HOME' as const, name: selectedFixture.home_team_name, score: selectedFixture.home_score },
                  { side: 'AWAY' as const, name: selectedFixture.away_team_name, score: selectedFixture.away_score },
                ]).map(team => (
                  <TouchableOpacity key={team.side} style={[styles.teamTab, activeSide === team.side && styles.teamTabActive]} onPress={() => setActiveSide(team.side)}>
                    <Text style={[styles.teamTabName, activeSide === team.side && styles.teamTabNameActive]} numberOfLines={1}>{team.name}</Text>
                    <Text style={styles.teamTabScore}>{team.score} PTS</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {playersLoading ? (
              <View style={styles.playersLoading}><ActivityIndicator color={colors.accent} /></View>
            ) : (
              <ScrollView style={styles.playerList} contentContainerStyle={styles.playerListContent}>
                {(activeSide === 'HOME' ? fixturePlayers.home : fixturePlayers.away).length === 0 ? (
                  <Text style={styles.noLineup}>Starting lineup is not available yet.</Text>
                ) : (activeSide === 'HOME' ? fixturePlayers.home : fixturePlayers.away).map(player => (
                  <TouchableOpacity key={`${player.user_id}-${player.player_id}`} style={styles.playerRow} onPress={() => setSelectedPlayer(player)}>
                    <View style={styles.playerCopy}>
                      <Text style={styles.playerName}>{player.player_name}</Text>
                      <Text style={styles.playerMeta}>{player.position} · {player.fpl_points} FPL + {player.defcon_points} DC</Text>
                    </View>
                    <Text style={styles.playerPoints}>{player.combined_points}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <LivePlayerBreakdownModal
        visible={Boolean(selectedPlayer)}
        player={selectedPlayer}
        gameweek={selectedFixture?.gameweek || 1}
        onClose={() => setSelectedPlayer(null)}
      />
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: appSpacing.md, paddingBottom: 44 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 1100, width: '100%', alignSelf: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { ...appTypography.label, color: colors.accent, fontSize: 8 },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', marginTop: 2 },
  subtitle: { color: colors.textMuted, fontSize: 10, fontWeight: '600', marginTop: 2 },
  createButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, backgroundColor: colors.accent, borderRadius: appRadius.small },
  createButtonText: { ...appTypography.label, color: colors.backgroundDeep, fontSize: 8 },
  errorBanner: { maxWidth: 1100, width: '100%', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: appSpacing.md, padding: appSpacing.sm, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerBorder, borderRadius: appRadius.small },
  errorText: { flex: 1, color: colors.danger, fontSize: 10, fontWeight: '700' },
  emptyCard: { maxWidth: 620, width: '100%', alignSelf: 'center', alignItems: 'center', marginTop: 60, padding: 30, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.large },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', marginTop: 10 },
  emptyText: { maxWidth: 420, color: colors.textMuted, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 5 },
  emptyAction: { minHeight: 40, justifyContent: 'center', marginTop: appSpacing.md, paddingHorizontal: 16, backgroundColor: colors.accent, borderRadius: appRadius.small },
  emptyActionText: { ...appTypography.label, color: colors.backgroundDeep, fontSize: 8 },
  cupPicker: { maxWidth: 1100, width: '100%', alignSelf: 'center', gap: 7, paddingVertical: appSpacing.md },
  cupPill: { maxWidth: 210, minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.pill },
  cupPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  cupPillText: { flexShrink: 1, color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  cupPillTextActive: { color: colors.backgroundDeep },
  cupHero: { maxWidth: 1100, width: '100%', alignSelf: 'center', overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: appRadius.large },
  cupHeroTop: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: appSpacing.md },
  trophyIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderRadius: appRadius.medium },
  cupHeroCopy: { flex: 1, minWidth: 0 },
  cupName: { color: colors.textPrimary, fontSize: 16, fontWeight: '900' },
  cupMeta: { color: colors.textMuted, fontSize: 9, fontWeight: '600', marginTop: 3 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 5, backgroundColor: colors.infoSoft, borderRadius: appRadius.pill },
  statusBadgeComplete: { backgroundColor: colors.accentSoft },
  statusBadgeText: { ...appTypography.label, color: colors.accent, fontSize: 7 },
  championStrip: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: appSpacing.md, paddingVertical: 9, backgroundColor: colors.accentSoft, borderTopWidth: 1, borderTopColor: colors.accentBorder },
  championLabel: { ...appTypography.label, color: colors.accent, fontSize: 7 },
  championName: { color: colors.textPrimary, fontSize: 11, fontWeight: '900' },
  bracketHeading: { maxWidth: 1100, width: '100%', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: appSpacing.lg, marginBottom: 7 },
  sectionLabel: { ...appTypography.label, color: colors.textPrimary, fontSize: 9 },
  bracketHint: { color: colors.textMuted, fontSize: 9, marginTop: 2 },
  bracketScroll: { minWidth: '100%', gap: appSpacing.md, paddingBottom: appSpacing.md },
  roundColumn: { width: 260, minHeight: 270, padding: appSpacing.sm, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium },
  roundHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  roundName: { color: colors.textPrimary, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  roundGameweek: { color: colors.accent, fontSize: 9, fontWeight: '900' },
  roundFixtures: { flex: 1, justifyContent: 'space-around', gap: 10, paddingVertical: 9 },
  pendingFixture: { minHeight: 80, alignItems: 'center', justifyContent: 'center', gap: 7, padding: appSpacing.md, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: appRadius.small },
  pendingFixtureText: { color: colors.textMuted, fontSize: 9, lineHeight: 14, textAlign: 'center' },
  fixtureCard: { padding: 9, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: appRadius.small },
  byeCard: { opacity: 0.78 },
  fixtureTopLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  matchNumber: { ...appTypography.label, color: colors.textMuted, fontSize: 6 },
  fixtureState: { color: colors.accent, fontSize: 7, fontWeight: '900' },
  teamRow: { minHeight: 29, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, borderRadius: 3 },
  winnerRow: { backgroundColor: colors.accentSoft },
  teamName: { flex: 1, color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  winnerText: { color: colors.textPrimary },
  teamScore: { width: 24, color: colors.textPrimary, fontSize: 12, fontWeight: '900', textAlign: 'right' },
  resolutionText: { color: colors.accent, fontSize: 7, fontWeight: '700', marginTop: 5 },
  openHint: { color: colors.textMuted, fontSize: 7, marginTop: 5 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.78)' },
  modalCard: { width: '100%', maxWidth: 760, maxHeight: '88%', alignSelf: 'center', padding: appSpacing.md, backgroundColor: colors.backgroundElevated, borderTopLeftRadius: appRadius.large, borderTopRightRadius: appRadius.large, borderWidth: 1, borderColor: colors.borderStrong },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: appSpacing.sm },
  modalEyebrow: { ...appTypography.label, color: colors.accent, fontSize: 7 },
  modalTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', marginTop: 2 },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: appRadius.pill },
  teamTabs: { flexDirection: 'row', gap: 7 },
  teamTab: { flex: 1, minWidth: 0, padding: 9, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small },
  teamTabActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  teamTabName: { color: colors.textMuted, fontSize: 10, fontWeight: '800' },
  teamTabNameActive: { color: colors.textPrimary },
  teamTabScore: { color: colors.accent, fontSize: 9, fontWeight: '900', marginTop: 2 },
  playersLoading: { minHeight: 220, alignItems: 'center', justifyContent: 'center' },
  playerList: { marginTop: appSpacing.sm },
  playerListContent: { paddingBottom: 30 },
  noLineup: { color: colors.textMuted, fontSize: 11, textAlign: 'center', padding: 30 },
  playerRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  playerCopy: { flex: 1 },
  playerName: { color: colors.textPrimary, fontSize: 11, fontWeight: '800' },
  playerMeta: { color: colors.textMuted, fontSize: 8, marginTop: 1 },
  playerPoints: { width: 32, color: colors.accent, fontSize: 13, fontWeight: '900', textAlign: 'right' },
});
