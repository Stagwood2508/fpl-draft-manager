import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/utils/supabase';

const POSITION_ORDER: Record<string, number> = {
  GKP: 1,
  DEF: 2,
  MID: 3,
  FWD: 4,
};

type ViewMode = 'RESULTS' | 'LIVE' | 'FIXTURES';

interface TeamOption {
  user_id: string;
  team_name: string;
}

interface PlayerScoreRow {
  id: number;
  web_name: string;
  element_type: string;
  live_points: number;
}

interface MatchupItem {
  id: string;
  gameweek: number;
  home_user_id: string;
  away_user_id: string;
  home_team_name: string;
  away_team_name: string;
  home_score: number;
  away_score: number;
  home_fpl_points: number;
  home_defcon_points: number;
  away_fpl_points: number;
  away_defcon_points: number;
  is_finished: boolean;
  home_players?: PlayerScoreRow[];
  away_players?: PlayerScoreRow[];
}

export default function MatchesScreen() {
  const [loading, setLoading] = useState(true);
  
  const [viewMode, setViewMode] = useState<ViewMode>('LIVE');
  const [currentGW, setCurrentGW] = useState<number>(1);
  const [selectedGameweek, setSelectedGameweek] = useState<number>(1);
  
  const [leagueTeams, setLeagueTeams] = useState<TeamOption[]>([]);
  const [selectedTeamUserId, setSelectedTeamUserId] = useState<string | null>(null);

  const [matchups, setMatchups] = useState<MatchupItem[]>([]);
  const [expandedMatchupId, setExpandedMatchupId] = useState<string | null>(null);

  const cachedLeagueId = useRef<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (viewMode === 'LIVE') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        ])
      ).start();
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
    fetchMatchdayData();

    let interval: NodeJS.Timeout | null = null;
    if (viewMode === 'LIVE') {
      interval = setInterval(() => {
        fetchMatchdayData(true);
      }, 30000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [viewMode, selectedGameweek, selectedTeamUserId]);

  async function initMatchdayContext() {
    try {
      setLoading(true);
      
      const { data: memberData } = await supabase
        .from('league_members')
        .select('league_id')
        .limit(1)
        .maybeSingle();

      if (memberData?.league_id) {
        cachedLeagueId.current = memberData.league_id;

        const { data: teamsData } = await supabase
          .from('league_members')
          .select('user_id, team_name')
          .eq('league_id', memberData.league_id);

        if (teamsData) {
          setLeagueTeams(teamsData.map(t => ({
            user_id: t.user_id,
            team_name: t.team_name || 'FC Manager'
          })));
        }
      }

      const { data: gwData } = await supabase
        .from('player_gameweek_stats')
        .select('gameweek')
        .order('gameweek', { ascending: false })
        .limit(1)
        .maybeSingle();

      const activeGW = gwData?.gameweek || 1;
      setCurrentGW(activeGW);
      setSelectedGameweek(activeGW);
    } catch (err: any) {
      console.error('Failed to initialize matchday context:', err.message);
    } finally {
      setLoading(false);
    }
  }

  const handleModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    setExpandedMatchupId(null);

    if (mode === 'LIVE') {
      setSelectedGameweek(currentGW);
    } else if (mode === 'RESULTS') {
      setSelectedGameweek(Math.max(1, currentGW - 1));
    } else if (mode === 'FIXTURES') {
      setSelectedGameweek(Math.min(38, currentGW + 1));
    }
  };

  async function fetchMatchdayData(isBackgroundRefresh = false) {
    try {
      if (!isBackgroundRefresh) setLoading(true);

      const currentLeagueId = cachedLeagueId.current;
      if (!currentLeagueId) return;

      let query = supabase
        .from('league_fixtures')
        .select('*')
        .eq('league_id', currentLeagueId);

      if (selectedTeamUserId && viewMode === 'FIXTURES') {
        query = query
          .eq('gameweek', selectedGameweek)
          .or(`home_user_id.eq.${selectedTeamUserId},away_user_id.eq.${selectedTeamUserId}`);
      } else if (viewMode !== 'LIVE') {
        query = query.eq('gameweek', selectedGameweek);
      } else {
        query = query.eq('gameweek', selectedGameweek);
      }

      const { data: fixturesData, error: fixturesErr } = await query;
      if (fixturesErr) throw fixturesErr;

      let liveScoreMap = new Map();
      if (viewMode === 'LIVE') {
        const { data: liveScores } = await supabase
          .rpc('get_live_fixture_scores', { p_gameweek: selectedGameweek });

        if (liveScores) {
          liveScoreMap = new Map(liveScores.map((s: any) => [s.fixture_id, s]));
        }
      }

      // BATCH FETCH ALL ROSTERS FOR ENTIRE LEAGUE IN 1 SINGLE QUERY
      const userIds = Array.from(new Set(
        (fixturesData || []).flatMap((f: any) => [f.home_user_id, f.away_user_id]).filter(Boolean)
      ));

      let userSquadsMap = new Map<string, PlayerScoreRow[]>();

      if (userIds.length > 0) {
        const { data: allRosters } = await supabase
          .from('rosters')
          .select('user_id, player_id')
          .eq('league_id', currentLeagueId)
          .eq('is_starting', true)
          .in('user_id', userIds);

        const allPlayerIds = Array.from(new Set((allRosters || []).map(r => r.player_id)));

        if (allPlayerIds.length > 0) {
          const [{ data: playersMeta }, { data: gwStats }] = await Promise.all([
            supabase.from('players').select('id, web_name, element_type').in('id', allPlayerIds),
            supabase
              .from('player_gameweek_stats')
              .select('player_id, total_points')
              .eq('gameweek', selectedGameweek)
              .in('player_id', allPlayerIds),
          ]);

          const playersMetaMap = new Map((playersMeta || []).map(p => [p.id, p]));
          const statsMap = new Map((gwStats || []).map(s => [s.player_id, s.total_points || 0]));

          (allRosters || []).forEach(r => {
            const p = playersMetaMap.get(r.player_id);
            if (!p) return;

            const row: PlayerScoreRow = {
              id: p.id,
              web_name: p.web_name,
              element_type: p.element_type || 'FWD',
              live_points: statsMap.get(p.id) || 0,
            };

            const existing = userSquadsMap.get(r.user_id) || [];
            existing.push(row);
            userSquadsMap.set(r.user_id, existing);
          });

          userSquadsMap.forEach((squad, uId) => {
            squad.sort((a, b) => (POSITION_ORDER[a.element_type] || 99) - (POSITION_ORDER[b.element_type] || 99));
          });
        }
      }

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
          home_players: userSquadsMap.get(match.home_user_id) || [],
          away_players: userSquadsMap.get(match.away_user_id) || [],
        };
      });

      setMatchups(processedMatchups);
    } catch (err: any) {
      console.error('Error loading matches:', err.message);
    } finally {
      setLoading(false);
    }
  }

  const toggleMatchupExpansion = (matchupId: string) => {
    setExpandedMatchupId(expandedMatchupId === matchupId ? null : matchupId);
  };

  const getAvailableGameweeks = () => {
    if (viewMode === 'RESULTS') {
      return Array.from({ length: Math.max(1, currentGW - 1) }, (_, i) => i + 1);
    }
    if (viewMode === 'FIXTURES') {
      return Array.from({ length: 38 - currentGW }, (_, i) => currentGW + 1 + i);
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
          style={[styles.segmentTab, viewMode === 'LIVE' && styles.segmentTabLiveActive]}
          onPress={() => handleModeChange('LIVE')}
        >
          <View style={styles.liveSegmentContent}>
            <Animated.View
              style={[
                styles.liveDot,
                { opacity: viewMode === 'LIVE' ? pulseAnim : 0.3, backgroundColor: viewMode === 'LIVE' ? '#FF3B30' : '#666' },
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
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color="#00ff87" />
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
                          <Text style={styles.scoreSeparator}>—</Text>
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
                      {viewMode !== 'FIXTURES' && (
                        <Text style={styles.pointsSubtext}>{match.away_fpl_points} FPL + {match.away_defcon_points} DC</Text>
                      )}
                    </View>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.expansionPanel}>
                      <View style={styles.panelHeaderRow}>
                        <Text style={styles.panelHeaderTitle}>Starting XI Matchup</Text>
                      </View>

                      <View style={styles.splitRosterGrid}>
                        <View style={styles.rosterColumn}>
                          {match.home_players?.map((p, idx) => (
                            <View key={idx} style={styles.playerScoreRow}>
                              <View style={{ width: '70%' }}>
                                <Text style={styles.pName} numberOfLines={1}>{p.web_name}</Text>
                                <Text style={styles.pPos}>{p.element_type}</Text>
                              </View>
                              <Text style={styles.pPoints}>{p.live_points} pts</Text>
                            </View>
                          ))}
                        </View>

                        <View style={styles.gridDivider} />

                        <View style={[styles.rosterColumn, { paddingLeft: 8, paddingRight: 0 }]}>
                          {match.away_players?.map((p, idx) => (
                            <View key={idx} style={[styles.playerScoreRow, { flexDirection: 'row-reverse' }]}>
                              <View style={{ width: '70%', alignItems: 'flex-end' }}>
                                <Text style={styles.pName} numberOfLines={1}>{p.web_name}</Text>
                                <Text style={styles.pPos}>{p.element_type}</Text>
                              </View>
                              <Text style={[styles.pPoints, { textAlign: 'left' }]}>{p.live_points} pts</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 13, textAlign: 'center', fontWeight: '600' },
  segmentBar: { flexDirection: 'row', backgroundColor: '#0F0F0F', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1A1A1A', gap: 8 },
  segmentTab: { flex: 1, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A1A1A', borderRadius: 6 },
  segmentTabActive: { backgroundColor: '#2A2A2A' },
  segmentTabLiveActive: { backgroundColor: '#3A1414' },
  liveSegmentContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  segmentText: { color: '#888', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  segmentTextActive: { color: '#FFF' },
  filterTrack: { paddingVertical: 8, backgroundColor: '#121212', borderBottomWidth: 1, borderBottomColor: '#1C1C1C' },
  filterLabel: { fontSize: 9, color: '#666', textTransform: 'uppercase', fontWeight: '800', marginLeft: 12, marginBottom: 6, letterSpacing: 0.5 },
  teamFilterBadge: { backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A', paddingVertical: 6, paddingHorizontal: 12, marginRight: 6, borderRadius: 4 },
  teamFilterBadgeActive: { borderColor: '#00ff87', backgroundColor: '#14251c' },
  teamFilterText: { color: '#888', fontSize: 10, fontWeight: '800' },
  teamFilterTextActive: { color: '#00ff87' },
  gameweekTrack: { paddingVertical: 10, backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#222' },
  trackScroll: { paddingHorizontal: 10 },
  gwBadge: { backgroundColor: '#000', borderWidth: 1, borderColor: '#333', paddingVertical: 6, paddingHorizontal: 14, marginRight: 8, borderRadius: 4 },
  gwBadgeActive: { borderColor: '#00ff87', backgroundColor: '#14251c' },
  gwText: { color: '#777', fontSize: 11, fontWeight: '700' },
  gwTextActive: { color: '#00ff87', fontWeight: '900' },
  liveHeaderBanner: { paddingVertical: 8, alignItems: 'center', backgroundColor: '#0F0F0F', borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  liveBannerBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#220808', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#551111', gap: 6 },
  pulsingBadge: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  liveBannerText: { color: '#FF3B30', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  scrollContent: { padding: 12, paddingBottom: 40 },
  matchupWrapper: { marginBottom: 12 },
  matchupCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 16, borderRadius: 6 },
  matchupCardExpanded: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderColor: '#00ff87' },
  teamColumn: { width: '35%' },
  managerTitle: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  pointsSubtext: { color: '#666', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', marginTop: 3, letterSpacing: 0.5 },
  scoreContainer: { width: '30%', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', position: 'relative' },
  liveScoreText: { color: '#FFF', fontSize: 18, fontWeight: '900', marginHorizontal: 4 },
  scoreSeparator: { color: '#333', fontSize: 14, fontWeight: '700' },
  vsBadge: { backgroundColor: '#1A1A1A', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 4, borderWidth: 1, borderColor: '#333' },
  vsText: { color: '#888', fontSize: 11, fontWeight: '900' },
  statusBadge: { position: 'absolute', top: -16, backgroundColor: '#14251c', borderWidth: 0.5, borderColor: '#00ff8755', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3 },
  statusText: { color: '#00ff87', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  finishedBadge: { backgroundColor: '#222', borderColor: '#444' },
  finishedText: { color: '#888' },
  upcomingBadge: { backgroundColor: '#1A1A1A', borderColor: '#333' },
  upcomingText: { color: '#AAA' },
  expansionPanel: { backgroundColor: '#09090b', borderWidth: 1, borderColor: '#00ff87', borderTopWidth: 0, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, padding: 12 },
  panelHeaderRow: { borderBottomWidth: 1, borderBottomColor: '#1c1c1c', paddingBottom: 6, marginBottom: 10 },
  panelHeaderTitle: { color: '#555', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  splitRosterGrid: { flexDirection: 'row', justifyContent: 'space-between', position: 'relative' },
  rosterColumn: { width: '49%', paddingRight: 8 },
  gridDivider: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: '#1c1c1c' },
  playerScoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#111', padding: 8, borderRadius: 4, marginBottom: 6, borderWidth: 0.5, borderColor: '#222' },
  pName: { color: '#CCC', fontSize: 11, fontWeight: '700' },
  pPos: { color: '#555', fontSize: 8, fontWeight: '800', marginTop: 1 },
  pPoints: { color: '#00ff87', fontSize: 11, fontWeight: '800', width: '30%', textAlign: 'right' },
});