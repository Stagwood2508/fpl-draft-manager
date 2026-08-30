import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { AppColors } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import LivePlayerBreakdownModal, { LivePlayerScore } from '@/components/LivePlayerBreakdownModal';

const POSITION_ORDER: Record<string, number> = {
  '1': 1,
  GK: 1,
  GKP: 1,
  '2': 2,
  DEF: 2,
  '3': 3,
  MID: 3,
  '4': 4,
  FWD: 4,
};

type ViewMode = 'RESULTS' | 'LIVE' | 'FIXTURES';

interface TeamOption {
  user_id: string;
  team_name: string;
}

type PlayerScoreRow = LivePlayerScore;

interface MatchupItem {
  id: string;
  gameweek: number;
  home_user_id: string;
  away_user_id: string | null;
  home_team_name: string;
  away_team_name: string;
  home_score: number;
  away_score: number;
  home_fpl_points: number;
  home_defcon_points: number;
  away_fpl_points: number;
  away_defcon_points: number;
  is_finished: boolean;
  is_league_average: boolean;
  home_players?: PlayerScoreRow[];
  away_players?: PlayerScoreRow[];
}

export default function MatchesScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const compactMatchup = width < 700;
  const [loading, setLoading] = useState(true);
  
  const [viewMode, setViewMode] = useState<ViewMode>('LIVE');
  const [currentGW, setCurrentGW] = useState<number>(1);
  const [selectedGameweek, setSelectedGameweek] = useState<number>(1);
  
  const [leagueTeams, setLeagueTeams] = useState<TeamOption[]>([]);
  const [selectedTeamUserId, setSelectedTeamUserId] = useState<string | null>(null);

  const [matchups, setMatchups] = useState<MatchupItem[]>([]);
  const [expandedMatchupId, setExpandedMatchupId] = useState<string | null>(null);
  const [activeRosterSides, setActiveRosterSides] = useState<Record<string, 'HOME' | 'AWAY'>>({});
  const [rosterPagerWidths, setRosterPagerWidths] = useState<Record<string, number>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<LivePlayerScore | null>(null);
  const [contextReady, setContextReady] = useState(false);
  const [gameweekIsLive, setGameweekIsLive] = useState(false);
  const [currentGameweekFinished, setCurrentGameweekFinished] = useState(false);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cachedLeagueId = useRef<string | null>(null);
  const rosterPagerRefs = useRef<Record<string, ScrollView | null>>({});
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (viewMode === 'LIVE') {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      pulseAnim.setValue(0.3);
    }
  }, [viewMode]);

  useFocusEffect(
    useCallback(() => {
      initMatchdayContext();
    }, [])
  );

  useEffect(() => {
    if (!contextReady) return;
    fetchMatchdayData();

    let interval: NodeJS.Timeout | null = null;
    if (viewMode === 'LIVE' && gameweekIsLive) {
      interval = setInterval(() => {
        fetchMatchdayData(true);
      }, 30000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [contextReady, viewMode, selectedGameweek, selectedTeamUserId, gameweekIsLive]);

  async function initMatchdayContext() {
    try {
      setLoading(true);
      setContextReady(false);
      
      // 1. Resolve Active League ID from AsyncStorage
      const storedLeagueId = await AsyncStorage.getItem('active_league_id');
      let targetLeagueId = storedLeagueId;

      if (!targetLeagueId) {
        const { data: memberData } = await supabase
          .from('league_members')
          .select('league_id')
          .limit(1)
          .maybeSingle();
        targetLeagueId = memberData?.league_id || null;
      }

      if (targetLeagueId) {
        cachedLeagueId.current = targetLeagueId;
        await AsyncStorage.setItem('active_league_id', targetLeagueId);

        const { data: teamsData } = await supabase
          .from('league_members')
          .select('user_id, team_name')
          .eq('league_id', targetLeagueId);

        if (teamsData) {
          setLeagueTeams(teamsData.map(t => ({
            user_id: t.user_id,
            team_name: t.team_name || 'FC Manager'
          })));
        }
      }

      if (!targetLeagueId) {
        setLeagueTeams([]);
        setMatchups([]);
        return;
      }

      const { data: gameweeksData, error: gameweeksError } = await supabase
        .from('league_gameweeks')
        .select('gameweek, gw_deadline, is_current, is_finished, status')
        .eq('league_id', targetLeagueId)
        .order('gameweek', { ascending: true });

      if (gameweeksError) throw gameweeksError;

      const now = Date.now();
      const gameweeks = gameweeksData || [];
      const activeGameweek = gameweeks.find((row: any) => row.is_current)
        || gameweeks.find((row: any) => !row.is_finished && new Date(row.gw_deadline).getTime() <= now)
        || gameweeks.find((row: any) => !row.is_finished)
        || gameweeks[gameweeks.length - 1];
      const activeGW = Number(activeGameweek?.gameweek || 1);
      const isFinished = Boolean(activeGameweek?.is_finished);
      const isLive = Boolean(
        activeGameweek
        && !isFinished
        && new Date(activeGameweek.gw_deadline).getTime() <= now
      );

      setCurrentGW(activeGW);
      setGameweekIsLive(isLive);
      setCurrentGameweekFinished(isFinished);

      if (isLive) {
        setViewMode('LIVE');
        setSelectedGameweek(activeGW);
      } else if (isFinished) {
        setViewMode('RESULTS');
        setSelectedGameweek(activeGW);
      } else {
        setViewMode('FIXTURES');
        setSelectedGameweek(activeGW);
      }
    } catch (err: any) {
      console.error('Failed to initialize matchday context:', err.message);
    } finally {
      setContextReady(true);
      setLoading(false);
    }
  }

  const handleModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    setExpandedMatchupId(null);
    setSelectedPlayer(null);

    if (mode === 'LIVE') {
      setSelectedGameweek(currentGW);
    } else if (mode === 'RESULTS') {
      setSelectedGameweek(currentGameweekFinished ? currentGW : Math.max(1, currentGW - 1));
    } else if (mode === 'FIXTURES') {
      setSelectedGameweek(gameweekIsLive || currentGameweekFinished ? Math.min(38, currentGW + 1) : currentGW);
    }
  };

  async function fetchMatchdayData(isBackgroundRefresh = false) {
    try {
      if (!isBackgroundRefresh) setLoading(true);
      setErrorMessage(null);

      const currentLeagueId = cachedLeagueId.current;
      if (!currentLeagueId) return;

      let query = supabase
        .from('league_fixtures')
        .select('*')
        .eq('league_id', currentLeagueId)
        .order('home_team_name', { ascending: true });

      if (selectedTeamUserId && viewMode === 'FIXTURES') {
        query = query
          .eq('gameweek', selectedGameweek)
          .or(`home_user_id.eq.${selectedTeamUserId},away_user_id.eq.${selectedTeamUserId}`);
      } else {
        query = query.eq('gameweek', selectedGameweek);
      }

      const [fixturesResult, liveScoresResult, playerScoresResult] = await Promise.all([
        query,
        viewMode === 'LIVE'
          ? supabase.rpc('get_league_live_fixture_scores', {
              p_league_id: currentLeagueId,
              p_gameweek: selectedGameweek,
            })
          : Promise.resolve({ data: [], error: null }),
        supabase.rpc('get_league_gameweek_player_scores', {
          p_league_id: currentLeagueId,
          p_gameweek: selectedGameweek,
        }),
      ]);

      if (fixturesResult.error) throw fixturesResult.error;
      if (liveScoresResult.error) throw liveScoresResult.error;
      if (playerScoresResult.error) throw playerScoresResult.error;

      const provisionalBonusResult = viewMode === 'LIVE'
        ? await supabase.rpc('get_gameweek_provisional_bonus_rankings', {
            p_gameweek: selectedGameweek,
          })
        : { data: [], error: null };

      if (provisionalBonusResult.error) {
        console.warn('Provisional live bonus rankings unavailable:', provisionalBonusResult.error.message);
      }

      const fixturesData = fixturesResult.data || [];
      const liveScoreMap = new Map<string, any>(
        (liveScoresResult.data || []).map((score: any) => [String(score.fixture_id), score])
      );
      const fixturePlayers = new Map<string, { home: PlayerScoreRow[]; away: PlayerScoreRow[] }>();
      const provisionalBonusMap = new Map<number, any>(
        (provisionalBonusResult.data || []).map((ranking: any) => [Number(ranking.player_id), ranking])
      );

      (playerScoresResult.data || []).forEach((rawPlayer: any) => {
        const bonusRanking = provisionalBonusMap.get(Number(rawPlayer.player_id));
        const player = {
          ...rawPlayer,
          bonus_rank: bonusRanking ? Number(bonusRanking.bonus_rank) : null,
          provisional_bonus_points: bonusRanking ? Number(bonusRanking.provisional_bonus_points) : 0,
        } as PlayerScoreRow;
        const fixture = fixturePlayers.get(player.fixture_id) || { home: [], away: [] };
        if (player.fixture_side === 'HOME') fixture.home.push(player);
        else fixture.away.push(player);
        fixturePlayers.set(player.fixture_id, fixture);
      });

      fixturePlayers.forEach((fixture) => {
        const sortPlayers = (a: PlayerScoreRow, b: PlayerScoreRow) =>
          (POSITION_ORDER[a.position] || 99) - (POSITION_ORDER[b.position] || 99)
          || a.player_name.localeCompare(b.player_name);
        fixture.home.sort(sortPlayers);
        fixture.away.sort(sortPlayers);
      });

      const updateTimes = (playerScoresResult.data || [])
        .map((player: any) => player.stats_updated_at)
        .filter(Boolean)
        .sort();
      setLiveUpdatedAt(updateTimes.length > 0 ? updateTimes[updateTimes.length - 1] : null);

      const processedMatchups = (fixturesData || []).map((match: any) => {
        const liveScoreData = liveScoreMap.get(match.id);

        let homeScore = match.home_score ?? 0;
        let awayScore = match.away_score ?? 0;
        let homeFpl = match.home_fpl_points ?? 0;
        let homeDefcon = match.home_defcon_points ?? 0;
        let awayFpl = match.away_fpl_points ?? 0;
        let awayDefcon = match.away_defcon_points ?? 0;

        if (viewMode === 'LIVE' && liveScoreData) {
          homeScore = liveScoreData.home_score ?? 0;
          awayScore = liveScoreData.away_score ?? 0;
          homeFpl = liveScoreData.home_fpl_points ?? 0;
          homeDefcon = liveScoreData.home_defcon_points ?? 0;
          awayFpl = liveScoreData.away_fpl_points ?? 0;
          awayDefcon = liveScoreData.away_defcon_points ?? 0;
        }

        return {
          ...match,
          home_score: homeScore,
          away_score: awayScore,
          home_fpl_points: homeFpl,
          home_defcon_points: homeDefcon,
          away_fpl_points: awayFpl,
          away_defcon_points: awayDefcon,
          home_players: fixturePlayers.get(match.id)?.home || [],
          away_players: fixturePlayers.get(match.id)?.away || [],
        };
      });

      setMatchups(processedMatchups);
      setSelectedPlayer((current) => {
        if (!current) return null;
        const refreshedRawPlayer = (playerScoresResult.data || []).find((player: any) =>
          player.fixture_id === current.fixture_id && Number(player.player_id) === Number(current.player_id)
        ) as any;
        if (!refreshedRawPlayer) return current;
        const refreshedBonus = provisionalBonusMap.get(Number(refreshedRawPlayer.player_id));
        return {
          ...refreshedRawPlayer,
          bonus_rank: refreshedBonus ? Number(refreshedBonus.bonus_rank) : null,
          provisional_bonus_points: refreshedBonus ? Number(refreshedBonus.provisional_bonus_points) : 0,
        } as LivePlayerScore;
      });
    } catch (err: any) {
      console.error('Error loading matches:', err.message);
      setErrorMessage(err?.message || 'Live Match Centre could not be refreshed.');
    } finally {
      setLoading(false);
    }
  }

  const toggleMatchupExpansion = (matchupId: string) => {
    setExpandedMatchupId(expandedMatchupId === matchupId ? null : matchupId);
    setActiveRosterSides(current => current[matchupId] ? current : { ...current, [matchupId]: 'HOME' });
  };

  const selectRosterSide = (matchupId: string, side: 'HOME' | 'AWAY') => {
    setActiveRosterSides(current => ({ ...current, [matchupId]: side }));
    const pageWidth = rosterPagerWidths[matchupId];
    if (pageWidth) {
      rosterPagerRefs.current[matchupId]?.scrollTo({
        x: side === 'AWAY' ? pageWidth : 0,
        animated: true,
      });
    }
  };

  const renderPlayerEvents = (player: PlayerScoreRow, alignRight = false) => {
    const events = [
      player.goal_count > 0 ? { icon: 'football-outline' as const, label: String(player.goal_count), color: colors.accent } : null,
      player.assist_count > 0 ? { icon: 'arrow-redo-outline' as const, label: String(player.assist_count), color: colors.info } : null,
      player.save_count > 0 ? { icon: 'hand-left-outline' as const, label: String(player.save_count), color: colors.warning } : null,
      player.defcon_points > 0 ? { icon: 'shield-checkmark-outline' as const, label: `+${player.defcon_points}`, color: colors.accent } : null,
      (player.provisional_bonus_points || 0) > 0 ? { icon: 'star' as const, label: `+${player.provisional_bonus_points}`, color: colors.warning } : null,
    ].filter(Boolean) as { icon: 'football-outline' | 'arrow-redo-outline' | 'hand-left-outline' | 'shield-checkmark-outline' | 'star'; label: string; color: string }[];

    if (events.length === 0) return null;

    return (
      <View style={[styles.playerEventRow, alignRight && styles.playerEventRowRight]}>
        {events.map((event, index) => (
          <View key={`${event.icon}-${index}`} style={styles.playerEventChip}>
            <Ionicons name={event.icon} size={10} color={event.color} />
            <Text style={[styles.playerEventText, { color: event.color }]}>{event.label}</Text>
          </View>
        ))}
      </View>
    );
  };

  const getAvailableGameweeks = () => {
    if (viewMode === 'RESULTS') {
      const latestResult = currentGameweekFinished ? currentGW : Math.max(1, currentGW - 1);
      return Array.from({ length: latestResult }, (_, i) => i + 1);
    }
    if (viewMode === 'FIXTURES') {
      const firstFixture = gameweekIsLive || currentGameweekFinished ? Math.min(38, currentGW + 1) : currentGW;
      return Array.from({ length: 39 - firstFixture }, (_, i) => firstFixture + i);
    }
    return [currentGW];
  };

  return (
    <View style={styles.container}>
      <View style={styles.segmentBar}>
        <TouchableOpacity
          style={[styles.segmentTab, viewMode === 'RESULTS' && styles.segmentTabActive]}
          onPress={() => handleModeChange('RESULTS')}
        >
          <Text style={[styles.segmentText, viewMode === 'RESULTS' && styles.segmentTextActive]}>RESULTS</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentTab, !gameweekIsLive && styles.segmentTabDisabled, viewMode === 'LIVE' && styles.segmentTabLiveActive]}
          onPress={() => handleModeChange('LIVE')}
          disabled={!gameweekIsLive}
        >
          <View style={styles.liveSegmentContent}>
            <Animated.View
              style={[
                styles.liveDot,
                { opacity: viewMode === 'LIVE' ? pulseAnim : 0.3, backgroundColor: viewMode === 'LIVE' ? colors.danger : colors.textMuted },
              ]}
            />
            <Text style={[styles.segmentText, viewMode === 'LIVE' && styles.segmentTextActive]}>LIVE</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentTab, viewMode === 'FIXTURES' && styles.segmentTabActive]}
          onPress={() => handleModeChange('FIXTURES')}
        >
          <Text style={[styles.segmentText, viewMode === 'FIXTURES' && styles.segmentTextActive]}>FIXTURES</Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'FIXTURES' && leagueTeams.length > 0 && (
        <View style={styles.filterTrack}>
          <Text style={styles.filterLabel}>Filter By Team</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.trackScroll}>
            <TouchableOpacity
              style={[styles.teamFilterBadge, selectedTeamUserId === null && styles.teamFilterBadgeActive]}
              onPress={() => setSelectedTeamUserId(null)}
            >
              <Text style={[styles.teamFilterText, selectedTeamUserId === null && styles.teamFilterTextActive]}>ALL TEAMS</Text>
            </TouchableOpacity>

            {leagueTeams.map((team) => (
              <TouchableOpacity
                key={team.user_id}
                style={[styles.teamFilterBadge, selectedTeamUserId === team.user_id && styles.teamFilterBadgeActive]}
                onPress={() => setSelectedTeamUserId(team.user_id)}
              >
                <Text style={[styles.teamFilterText, selectedTeamUserId === team.user_id && styles.teamFilterTextActive]}>{team.team_name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {viewMode !== 'LIVE' && (
        <View style={styles.gameweekTrack}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.trackScroll}>
            {getAvailableGameweeks().map((gw) => (
              <TouchableOpacity
                key={gw}
                style={[styles.gwBadge, selectedGameweek === gw && styles.gwBadgeActive]}
                onPress={() => setSelectedGameweek(gw)}
              >
                <Text style={[styles.gwText, selectedGameweek === gw && styles.gwTextActive]}>GW {gw}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {viewMode === 'LIVE' && (
        <View style={styles.liveHeaderBanner}>
          <View style={styles.liveBannerBadge}>
            <Animated.View style={[styles.pulsingBadge, { opacity: pulseAnim }]} />
            <Text style={styles.liveBannerText}>IN-PLAY GAMEWEEK {currentGW}</Text>
          </View>
          <Text style={[
            styles.liveUpdateText,
            liveUpdatedAt && Date.now() - new Date(liveUpdatedAt).getTime() > 180000 && styles.liveUpdateStale,
          ]}>
            {liveUpdatedAt
              ? `UPDATED ${new Date(liveUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'AWAITING LIVE DATA'}
          </Text>
        </View>
      )}

      {errorMessage && (
        <TouchableOpacity style={styles.errorBanner} onPress={() => fetchMatchdayData()}>
          <Text style={styles.errorText}>LIVE DATA INTERRUPTED · TAP TO RETRY</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {matchups.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {viewMode === 'RESULTS'
                  ? 'No completed match results found.'
                  : viewMode === 'FIXTURES'
                  ? 'No upcoming fixtures found for this selection.'
                  : `No live fixtures currently in play for Gameweek ${currentGW}.`}
              </Text>
            </View>
          ) : (
            matchups.map((match) => {
              const isExpanded = expandedMatchupId === match.id;

              return (
                <View key={match.id} style={styles.matchupWrapper}>
                  <TouchableOpacity
                    style={[styles.matchupCard, isExpanded && styles.matchupCardExpanded]}
                    onPress={() => toggleMatchupExpansion(match.id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.teamColumn}>
                      <Text style={styles.managerTitle} numberOfLines={1}>{match.home_team_name || 'Home FC'}</Text>
                      {viewMode !== 'FIXTURES' && (
                        <Text style={styles.pointsSubtext}>{match.home_fpl_points} FPL + {match.home_defcon_points} DC</Text>
                      )}
                    </View>

                    <View style={styles.scoreContainer}>
                      {viewMode === 'FIXTURES' ? (
                        <View style={styles.vsBadge}><Text style={styles.vsText}>VS</Text></View>
                      ) : (
                        <>
                          <Text style={styles.liveScoreText}>{match.home_score}</Text>
                          <Text style={styles.scoreSeparator}>-</Text>
                          <Text style={styles.liveScoreText}>{match.away_score}</Text>
                        </>
                      )}

                      <View style={[styles.statusBadge, viewMode === 'RESULTS' && styles.finishedBadge, viewMode === 'FIXTURES' && styles.upcomingBadge]}>
                        <Text style={[styles.statusText, viewMode === 'RESULTS' && styles.finishedText, viewMode === 'FIXTURES' && styles.upcomingText]}>
                          {viewMode === 'RESULTS' ? 'FT' : `GW${match.gameweek}`}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.teamColumn, { alignItems: 'flex-end' }]}>
                      <Text style={styles.managerTitle} numberOfLines={1}>{match.away_team_name || 'Away FC'}</Text>
                      {match.is_league_average && (
                        <Text style={styles.averageOpponentLabel}>OTHER MANAGERS' AVERAGE</Text>
                      )}
                      {viewMode !== 'FIXTURES' && (
                        <Text style={styles.pointsSubtext}>{match.away_fpl_points} FPL + {match.away_defcon_points} DC</Text>
                      )}
                    </View>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.expansionPanel}>
                      <View style={styles.panelHeaderRow}>
                        <Text style={styles.panelHeaderTitle}>Starting XI Matchup</Text>
                        {viewMode === 'LIVE' && (
                          <Text style={styles.provisionalText}>Provisional · autosubs are applied when the Gameweek finishes</Text>
                        )}
                      </View>

                      {compactMatchup ? (
                        <View style={styles.mobileRosterPager}>
                          <View style={styles.mobileTeamTabs}>
                            {([
                              { side: 'HOME' as const, name: match.home_team_name, score: match.home_score },
                              { side: 'AWAY' as const, name: match.away_team_name, score: match.away_score },
                            ]).map(team => {
                              const isActive = (activeRosterSides[match.id] || 'HOME') === team.side;
                              return (
                                <TouchableOpacity
                                  key={team.side}
                                  style={[styles.mobileTeamTab, isActive && styles.mobileTeamTabActive]}
                                  onPress={() => selectRosterSide(match.id, team.side)}
                                >
                                  <Text style={[styles.mobileTeamTabName, isActive && styles.mobileTeamTabNameActive]} numberOfLines={1}>
                                    {team.name}
                                  </Text>
                                  <Text style={[styles.mobileTeamTabScore, isActive && styles.mobileTeamTabScoreActive]}>
                                    {viewMode === 'FIXTURES' ? 'XI' : `${team.score} PTS`}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>

                          <View
                            style={styles.mobileRosterViewport}
                            onLayout={(event) => {
                              const pageWidth = event.nativeEvent.layout.width;
                              if (pageWidth > 0 && rosterPagerWidths[match.id] !== pageWidth) {
                                setRosterPagerWidths(current => ({ ...current, [match.id]: pageWidth }));
                              }
                            }}
                          >
                            <ScrollView
                              ref={(ref) => { rosterPagerRefs.current[match.id] = ref; }}
                              horizontal
                              pagingEnabled
                              nestedScrollEnabled
                              showsHorizontalScrollIndicator={false}
                              scrollEventThrottle={16}
                              onMomentumScrollEnd={(event) => {
                                const pageWidth = rosterPagerWidths[match.id] || event.nativeEvent.layoutMeasurement.width;
                                const side = event.nativeEvent.contentOffset.x >= pageWidth / 2 ? 'AWAY' : 'HOME';
                                setActiveRosterSides(current => ({ ...current, [match.id]: side }));
                              }}
                            >
                              <View style={[styles.mobileRosterPage, { width: rosterPagerWidths[match.id] || Math.max(260, width - 50) }]}>
                                {match.home_players?.length === 0 ? (
                                  <Text style={styles.lineupUnavailable}>Lineup unavailable</Text>
                                ) : match.home_players?.map((p) => (
                                  <TouchableOpacity key={p.player_id} style={styles.playerScoreRow} onPress={() => setSelectedPlayer(p)}>
                                    <View style={{ width: '70%' }}>
                                      <Text style={styles.pName} numberOfLines={1}>{p.player_name}</Text>
                                      <Text style={styles.pPos}>{p.position} · {p.fpl_points} FPL + {p.defcon_points} DC</Text>
                                      {renderPlayerEvents(p)}
                                    </View>
                                    <Text style={styles.pPoints}>{p.combined_points} pts</Text>
                                  </TouchableOpacity>
                                ))}
                              </View>

                              <View style={[styles.mobileRosterPage, { width: rosterPagerWidths[match.id] || Math.max(260, width - 50) }]}>
                                {match.is_league_average ? (
                                  <View style={styles.averageExplanation}>
                                    <Text style={styles.averageExplanationTitle}>LEAGUE AVERAGE</Text>
                                    <Text style={styles.averageExplanationText}>
                                      Rounded average of every other manager's score. Your own score is excluded.
                                    </Text>
                                  </View>
                                ) : match.away_players?.length === 0 ? (
                                  <Text style={styles.lineupUnavailable}>Lineup unavailable</Text>
                                ) : match.away_players?.map((p) => (
                                  <TouchableOpacity key={p.player_id} style={styles.playerScoreRow} onPress={() => setSelectedPlayer(p)}>
                                    <View style={{ width: '70%' }}>
                                      <Text style={styles.pName} numberOfLines={1}>{p.player_name}</Text>
                                      <Text style={styles.pPos}>{p.position} · {p.fpl_points} FPL + {p.defcon_points} DC</Text>
                                      {renderPlayerEvents(p)}
                                    </View>
                                    <Text style={styles.pPoints}>{p.combined_points} pts</Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </ScrollView>
                          </View>

                          <View style={styles.mobileSwipeHint}>
                            <View style={[styles.mobileSwipeDot, (activeRosterSides[match.id] || 'HOME') === 'HOME' && styles.mobileSwipeDotActive]} />
                            <Text style={styles.mobileSwipeHintText}>SWIPE BETWEEN TEAMS</Text>
                            <View style={[styles.mobileSwipeDot, activeRosterSides[match.id] === 'AWAY' && styles.mobileSwipeDotActive]} />
                          </View>
                        </View>
                      ) : (
                        <View style={styles.splitRosterGrid}>
                          <View style={styles.rosterColumn}>
                            {match.home_players?.length === 0 && <Text style={styles.lineupUnavailable}>Lineup unavailable</Text>}
                            {match.home_players?.map((p) => (
                              <TouchableOpacity key={p.player_id} style={styles.playerScoreRow} onPress={() => setSelectedPlayer(p)}>
                                <View style={{ width: '70%' }}>
                                  <Text style={styles.pName} numberOfLines={1}>{p.player_name}</Text>
                                  <Text style={styles.pPos}>{p.position} · {p.fpl_points} FPL + {p.defcon_points} DC</Text>
                                  {renderPlayerEvents(p)}
                                </View>
                                <Text style={styles.pPoints}>{p.combined_points} pts</Text>
                              </TouchableOpacity>
                            ))}
                          </View>

                          <View style={styles.gridDivider} />

                          <View style={[styles.rosterColumn, { paddingLeft: 8, paddingRight: 0 }]}>
                            {match.is_league_average ? (
                              <View style={styles.averageExplanation}>
                                <Text style={styles.averageExplanationTitle}>LEAGUE AVERAGE</Text>
                                <Text style={styles.averageExplanationText}>Rounded average of every other manager's score. Your own score is excluded.</Text>
                              </View>
                            ) : match.away_players?.length === 0 ? (
                              <Text style={styles.lineupUnavailable}>Lineup unavailable</Text>
                            ) : match.away_players?.map((p) => (
                              <TouchableOpacity key={p.player_id} style={[styles.playerScoreRow, { flexDirection: 'row-reverse' }]} onPress={() => setSelectedPlayer(p)}>
                                <View style={{ width: '70%', alignItems: 'flex-end' }}>
                                  <Text style={styles.pName} numberOfLines={1}>{p.player_name}</Text>
                                  <Text style={styles.pPos}>{p.position} · {p.fpl_points} FPL + {p.defcon_points} DC</Text>
                                  {renderPlayerEvents(p, true)}
                                </View>
                                <Text style={[styles.pPoints, { textAlign: 'left' }]}>{p.combined_points} pts</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <LivePlayerBreakdownModal
        visible={Boolean(selectedPlayer)}
        player={selectedPlayer}
        gameweek={selectedGameweek}
        onClose={() => setSelectedPlayer(null)}
      />
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', fontWeight: '600' },
  segmentBar: { flexDirection: 'row', backgroundColor: colors.backgroundDeep, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
  segmentTab: { flex: 1, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 6 },
  segmentTabDisabled: { opacity: 0.42 },
  segmentTabActive: { backgroundColor: colors.surfacePressed },
  segmentTabLiveActive: { backgroundColor: colors.dangerSoft },
  liveSegmentContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  segmentText: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  segmentTextActive: { color: colors.textPrimary },
  filterTrack: { paddingVertical: 8, backgroundColor: colors.backgroundElevated, borderBottomWidth: 1, borderBottomColor: colors.border },
  filterLabel: { fontSize: 9, color: colors.textMuted, textTransform: 'uppercase', fontWeight: '800', marginLeft: 12, marginBottom: 6, letterSpacing: 0.5 },
  teamFilterBadge: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border, paddingVertical: 6, paddingHorizontal: 12, marginRight: 6, borderRadius: 4 },
  teamFilterBadgeActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  teamFilterText: { color: colors.textMuted, fontSize: 10, fontWeight: '800' },
  teamFilterTextActive: { color: colors.accent },
  gameweekTrack: { paddingVertical: 10, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  trackScroll: { paddingHorizontal: 10 },
  gwBadge: { backgroundColor: colors.backgroundDeep, borderWidth: 1, borderColor: colors.borderStrong, paddingVertical: 6, paddingHorizontal: 14, marginRight: 8, borderRadius: 4 },
  gwBadgeActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  gwText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  gwTextActive: { color: colors.accent, fontWeight: '900' },
  liveHeaderBanner: { paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.backgroundDeep, borderBottomWidth: 1, borderBottomColor: colors.border },
  liveBannerBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.dangerSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.dangerBorder, gap: 6 },
  pulsingBadge: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  liveBannerText: { color: colors.danger, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  liveUpdateText: { color: colors.textMuted, fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
  liveUpdateStale: { color: colors.warning },
  errorBanner: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.dangerSoft, borderBottomWidth: 1, borderBottomColor: colors.dangerBorder, alignItems: 'center' },
  errorText: { color: colors.danger, fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  scrollContent: { padding: 12, paddingBottom: 40 },
  matchupWrapper: { marginBottom: 12 },
  matchupCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 16, borderRadius: 6 },
  matchupCardExpanded: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderColor: colors.accent },
  averageOpponentLabel: { color: colors.accent, fontSize: 7, fontWeight: '900', marginTop: 3, letterSpacing: 0.35 },
  averageExplanation: { flex: 1, minHeight: 90, alignItems: 'center', justifyContent: 'center', padding: 10 },
  averageExplanationTitle: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  averageExplanationText: { color: colors.textSecondary, fontSize: 9, fontWeight: '700', lineHeight: 14, textAlign: 'center', marginTop: 6 },
  teamColumn: { width: '35%' },
  managerTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 13 },
  pointsSubtext: { color: colors.textMuted, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', marginTop: 3, letterSpacing: 0.5 },
  scoreContainer: { width: '30%', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', position: 'relative' },
  liveScoreText: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginHorizontal: 4 },
  scoreSeparator: { color: colors.borderStrong, fontSize: 14, fontWeight: '700' },
  vsBadge: { backgroundColor: colors.surfaceMuted, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 4, borderWidth: 1, borderColor: colors.borderStrong },
  vsText: { color: colors.textMuted, fontSize: 11, fontWeight: '900' },
  statusBadge: { position: 'absolute', top: -16, backgroundColor: colors.accentSoft, borderWidth: 0.5, borderColor: colors.accentBorder, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3 },
  statusText: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  finishedBadge: { backgroundColor: colors.surfacePressed, borderColor: colors.borderStrong },
  finishedText: { color: colors.textMuted },
  upcomingBadge: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  upcomingText: { color: colors.textSecondary },
  expansionPanel: { backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.accent, borderTopWidth: 0, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, padding: 12 },
  panelHeaderRow: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 6, marginBottom: 10 },
  panelHeaderTitle: { color: colors.textMuted, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  provisionalText: { color: colors.warning, fontSize: 8, fontWeight: '700', marginTop: 3 },
  splitRosterGrid: { flexDirection: 'row', justifyContent: 'space-between', position: 'relative' },
  rosterColumn: { width: '49%', paddingRight: 8 },
  mobileRosterPager: { width: '100%' },
  mobileTeamTabs: { flexDirection: 'row', padding: 3, backgroundColor: colors.backgroundDeep, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginBottom: 8, gap: 3 },
  mobileTeamTab: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderRadius: 6 },
  mobileTeamTabActive: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder },
  mobileTeamTabName: { maxWidth: '100%', color: colors.textMuted, fontSize: 10, fontWeight: '800' },
  mobileTeamTabNameActive: { color: colors.textPrimary },
  mobileTeamTabScore: { color: colors.textMuted, fontSize: 8, fontWeight: '900', marginTop: 2, letterSpacing: 0.3 },
  mobileTeamTabScoreActive: { color: colors.accent },
  mobileRosterViewport: { width: '100%', overflow: 'hidden' },
  mobileRosterPage: { paddingHorizontal: 1 },
  mobileSwipeHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 3 },
  mobileSwipeHintText: { color: colors.textMuted, fontSize: 7, fontWeight: '900', letterSpacing: 0.45 },
  mobileSwipeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
  mobileSwipeDotActive: { width: 12, backgroundColor: colors.accentFill },
  lineupUnavailable: { color: colors.textMuted, fontSize: 9, fontWeight: '700', textAlign: 'center', paddingVertical: 16 },
  gridDivider: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: colors.border },
  playerScoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, padding: 8, borderRadius: 4, marginBottom: 6, borderWidth: 0.5, borderColor: colors.border },
  pName: { color: colors.textPrimary, fontSize: 11, fontWeight: '700' },
  pPos: { color: colors.textMuted, fontSize: 8, fontWeight: '800', marginTop: 1 },
  playerEventRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 4 },
  playerEventRowRight: { justifyContent: 'flex-end' },
  playerEventChip: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.surfaceMuted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  playerEventText: { fontSize: 7, fontWeight: '900' },
  pPoints: { color: colors.accent, fontSize: 11, fontWeight: '800', width: '30%', textAlign: 'right' },
});
