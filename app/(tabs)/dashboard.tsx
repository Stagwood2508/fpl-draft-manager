import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions
} from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../../utils/supabase';
import { synchronizeFplPlayerPool } from '../../utils/fplSync'; 
import DraftCountdownCard from '../../components/DraftCountdownCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface LeagueMetadata {
  id: string;
  name: string;
  draft_status: string;
}

interface LeaderboardRow {
  user_id: string;
  team_name: string;
  total_fantasy_points: number;
  league_points: number;
  rank: number;
}

export default function HomeDashboardScreen() {
  const isFocused = useIsFocused();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [syncingPool, setSyncingPool] = useState(false); 

  // Context State
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [leagueMeta, setLeagueMeta] = useState<LeagueMetadata | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  
  // Dynamic Access & Completion States
  const [canEnterDraftRoom, setCanEnterDraftRoom] = useState(false);
  const [isDraftCompleted, setIsDraftCompleted] = useState(false);

  // Live Performance Metrics State
  const [currentGameweek, setCurrentGameweek] = useState<number>(1);
  const [nextDeadlineGameweek, setNextDeadlineGameweek] = useState<number>(1);
  const [myLivePoints, setMyLivePoints] = useState<number>(0);
  const [leagueAveragePoints, setLeagueAveragePoints] = useState<number>(0);
  const [ptsDiff, setPtsDiff] = useState<number>(0);

  // Live Countdown Clock State
  const [targetDeadline, setTargetDeadline] = useState<Date | null>(null);
  const [deadlineString, setDeadlineString] = useState('00d 00h 00m 00s');

  useEffect(() => {
    if (isFocused) {
      syncDashboardEngine();
    }
  }, [isFocused]);

  // LIVE GAMEWEEK DEADLINE COUNTDOWN TIMER TICK
  useEffect(() => {
    if (!targetDeadline) return;

    const updateClock = () => {
      const now = Date.now();
      const diff = targetDeadline.getTime() - now;

      if (diff <= 0) {
        setDeadlineString('DEADLINE PASSED');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const mins = Math.floor((diff / (1000 * 60)) % 60);
      const secs = Math.floor((diff / 1000) % 60);

      const formatted = `${String(days).padStart(2, '0')}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
      setDeadlineString(formatted);
    };

    updateClock(); // Run immediately
    const clockInterval = setInterval(updateClock, 1000);

    return () => clearInterval(clockInterval);
  }, [targetDeadline]);

  useEffect(() => {
    if (!isFocused || !leagueMeta?.id || isDraftCompleted) return;

    const checkGateInterval = setInterval(async () => {
      const { data: settingsData } = await supabase
        .from('league_settings')
        .select('draft_start_time')
        .eq('league_id', leagueId)
        .maybeSingle();

      if (settingsData?.draft_start_time) {
        const targetStartTime = new Date(settingsData.draft_start_time).getTime();
        const msUntilKickoff = targetStartTime - Date.now();
        const tenMinutesInMs = 10 * 60 * 1000;

        if ((msUntilKickoff <= tenMinutesInMs && msUntilKickoff > 0) || leagueMeta.draft_status === 'LIVE') {
          setCanEnterDraftRoom(true);
          clearInterval(checkGateInterval);
        }
      }
    }, 5000);

    return () => clearInterval(checkGateInterval);
  }, [isFocused, leagueId, leagueMeta, isDraftCompleted]);

  const syncDashboardEngine = async () => {
    try {
      setLoading(true);

      // 1. Resolve Active User Context
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error('User authentication token lost.');

      // 2. Resolve Active League Metadata
      const { data: memberData, error: memberErr } = await supabase
        .from('league_members')
        .select(`
          league_id,
          leagues ( id, name, draft_status )
        `)
        .limit(1)
        .single();

      if (memberErr || !memberData?.leagues) throw new Error('No assigned league membership profile identified.');
      
      const currentLeagueMeta = memberData.leagues as unknown as LeagueMetadata;
      setLeagueId(currentLeagueMeta.id);
      setLeagueMeta(currentLeagueMeta);

      // 3. Check official draft status from the 'draft_sessions' table
      const { data: draftSessionData, error: draftSessionErr } = await supabase
        .from('draft_sessions')
        .select('draft_status')
        .eq('league_id', currentLeagueMeta.id)
        .maybeSingle();

      const draftFinished = draftSessionData?.draft_status === 'COMPLETED' || draftSessionData?.draft_status === 'finished';

      if (!draftSessionErr && draftFinished) {
        setIsDraftCompleted(true);
        setCanEnterDraftRoom(false);
      } else {
        setIsDraftCompleted(false);

        // 4. Fetch Draft Start Time Constraints from League Settings
        const { data: settingsData, error: settingsErr } = await supabase
          .from('league_settings')
          .select('draft_start_time')
          .eq('league_id', currentLeagueMeta.id)
          .maybeSingle();

        if (!settingsErr && settingsData?.draft_start_time) {
          const targetStartTime = new Date(settingsData.draft_start_time).getTime();
          const currentTime = Date.now();
          const msUntilKickoff = targetStartTime - currentTime;
          const tenMinutesInMs = 10 * 60 * 1000;

          if ((msUntilKickoff <= tenMinutesInMs && msUntilKickoff > 0) || currentLeagueMeta.draft_status === 'LIVE') {
            setCanEnterDraftRoom(true);
          } else {
            setCanEnterDraftRoom(false);
          }
        }
      }

      // 5. Fetch real live standings from league_standings table
      const { data: standingsData, error: standingsErr } = await supabase
        .from('league_standings')
        .select('user_id, team_name, total_fantasy_points, league_points')
        .eq('league_id', currentLeagueMeta.id)
        .order('league_points', { ascending: false })
        .order('total_fantasy_points', { ascending: false });

      if (standingsErr) {
        console.error('Error fetching standings:', standingsErr);
      } else if (standingsData) {
        const rankedStandings: LeaderboardRow[] = standingsData.map((row, index) => ({
          ...row,
          rank: index + 1,
        }));
        setLeaderboard(rankedStandings);
      }

      // 6. Fetch Real Live Gameweek Performance Metrics
      const { data: liveMetrics, error: liveMetricsErr } = await supabase.rpc('get_live_dashboard_metrics', {
        p_league_id: currentLeagueMeta.id,
        p_user_id: user.id,
      });

      if (!liveMetricsErr && liveMetrics && liveMetrics.length > 0) {
        const metric = liveMetrics[0];
        setCurrentGameweek(metric.current_gameweek || 1);
        setMyLivePoints(metric.my_live_points || 0);
        setLeagueAveragePoints(metric.league_avg_points || 0);
        setPtsDiff(metric.pts_diff || 0);
      }

      // 7. Fetch Real Next Gameweek Deadline
      const { data: deadlineData, error: deadlineErr } = await supabase.rpc('get_next_gameweek_deadline');
      if (!deadlineErr && deadlineData && deadlineData.length > 0) {
        const nextGw = deadlineData[0];
        setNextDeadlineGameweek(nextGw.gameweek || currentGameweek + 1);
        if (nextGw.deadline_time) {
          setTargetDeadline(new Date(nextGw.deadline_time));
        }
      }

    } catch (err: any) {
      Alert.alert('Dashboard Sync Interrupted', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManualFplSync = async () => {
    try {
      setSyncingPool(true);
      const result = await synchronizeFplPlayerPool();
      
      if (result.success) {
        Alert.alert('Data Ingest Complete', `Successfully upserted ${result.count} Premier League assets into Supabase.`);
      } else {
        Alert.alert('Sync Process Failure', result.error);
      }
    } catch (err: any) {
      Alert.alert('Exception Intercepted', err.message);
    } finally {
      setSyncingPool(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00ff87" />
      </View>
    );
  }

  const isPositiveSpread = ptsDiff >= 0;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* LEAGUE HEADER HUB */}
        <View style={styles.leagueHeaderCard}>
          <Text style={styles.metaLabel}>Active Context Room</Text>
          <Text style={styles.leagueNameText}>{leagueMeta?.name || 'Loading League...'}</Text>
          <View style={styles.phaseBadge}>
            <Text style={styles.phaseBadgeText}>
              STATUS: {isDraftCompleted ? '🟢 DRAFT COMPLETED' : leagueMeta?.draft_status === 'LIVE' ? '🔴 DRAFT IN PROGRESS' : '⚙️ ' + leagueMeta?.draft_status}
            </Text>
          </View>
        </View>

        {/* COMPLETION GUARD */}
        {!isDraftCompleted && (
          canEnterDraftRoom ? (
            <TouchableOpacity 
              style={styles.enterDraftRoomActionCard}
              onPress={() => router.push('/draft-room')}
              activeOpacity={0.8}
            >
              <View style={styles.liveIndicatorPulseContainer}>
                <View style={styles.pulseDotElement} />
                <Text style={styles.liveRoomBadgeText}>DRAFT WORKSPACE OPEN</Text>
              </View>
              <Text style={styles.enterButtonPrimaryText}>ENTER LIVE WAITING ROOM</Text>
              <Text style={styles.enterButtonSecondarySubtext}>Squad selection controls activate at schedule lock</Text>
            </TouchableOpacity>
          ) : (
            <DraftCountdownCard />
          )
        )}

        {/* ROW 1: DYNAMIC TRANSFER DEADLINE COUNTDOWN TIMER */}
        <View style={styles.deadlineCard}>
          <View style={styles.deadlineMetaColumn}>
            <Text style={styles.deadlineTitle}>Gameweek {nextDeadlineGameweek} Deadline</Text>
            <Text style={styles.deadlineSub}>Squad lock parameters activate soon.</Text>
          </View>
          <View style={styles.timerContainer}>
            <Text style={styles.timerStringText}>{deadlineString}</Text>
          </View>
        </View>

        {/* ROW 2: LIVE PERFORMANCE MATRIX */}
        <Text style={styles.sectionHeaderTitle}>Live Performance Matrix (GW{currentGameweek})</Text>
        <View style={styles.statsGridRow}>
          <View style={[styles.statsCard, { borderColor: isPositiveSpread ? '#00ff8744' : '#FF175144' }]}>
            <Text style={styles.statsLabel}>MY LIVE SCORE</Text>
            <Text style={styles.statsValue}>{myLivePoints}</Text>
            <Text style={isPositiveSpread ? styles.statsFooterGreen : styles.statsFooterRed}>
              {isPositiveSpread ? `▲ +${ptsDiff} vs Avg` : `▼ ${ptsDiff} vs Avg`}
            </Text>
          </View>
          
          <View style={styles.statsCard}>
            <Text style={styles.statsLabel}>LEAGUE AVERAGE</Text>
            <Text style={styles.statsValue}>{leagueAveragePoints}</Text>
            <Text style={styles.statsFooterGray}>
              {isPositiveSpread ? `+${ptsDiff} pts net spread` : `${ptsDiff} pts net spread`}
            </Text>
          </View>
        </View>

        {/* ROW 3: LEAGUE STANDINGS WIDGET */}
        <View style={styles.leaderboardContainerCard}>
          <View style={styles.leaderboardHeader}>
            <Text style={styles.leaderboardTitleText}>League Standings</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/league/fixtures')}>
              <Text style={styles.viewFixturesLinkText}>VIEW FIXTURES ➔</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tableHeaderRow}>
            <Text style={[styles.thText, { width: '10%' }]}>Rk</Text>
            <Text style={[styles.thText, { width: '50%' }]}>Manager / Team</Text>
            <Text style={[styles.thText, { width: '20%', textAlign: 'center' }]}>FPL Pts</Text>
            <Text style={[styles.thText, { width: '20%', textAlign: 'right' }]}>H2H Pts</Text>
          </View>

          {leaderboard.map((row) => (
            <View key={row.user_id} style={[styles.leaderboardRow, row.rank === 1 && styles.leaderboardRowTopSpot]}>
              <View style={styles.rankCol}>
                <Text style={[styles.rankText, row.rank === 1 && styles.rankTextGold]}>#{row.rank}</Text>
              </View>
              <View style={styles.managerNameCol}>
                <Text style={styles.mNameText} numberOfLines={1}>{row.team_name}</Text>
              </View>
              <View style={styles.fplPointsCol}>
                <Text style={styles.pointsValueText}>{row.total_fantasy_points}</Text>
              </View>
              <View style={styles.h2hPointsCol}>
                <Text style={styles.h2hValueText}>{row.league_points}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ACTION SHORTCUTS */}
        <Text style={styles.sectionHeaderTitle}>Quick Action Framework</Text>
        <View style={styles.actionGrid}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(tabs)/players/scout')}>
            <Text style={styles.actionBtnIcon}>🔍</Text>
            <Text style={styles.actionBtnText}>Scout Recruitment</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(tabs)/players/watchlist')}>
            <Text style={styles.actionBtnIcon}>⭐</Text>
            <Text style={styles.actionBtnText}>Target Watchlist</Text>
          </TouchableOpacity>
        </View>

        {/* DEV TOOLS */}
        <View style={styles.devCard}>
          <Text style={styles.devTitle}>Developer Sandbox Tools</Text>
          <TouchableOpacity 
            style={styles.syncBtn} 
            onPress={handleManualFplSync} 
            disabled={syncingPool}
          >
            {syncingPool ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={styles.syncBtnText}>🔄 FORCE RE-SYNC PLAYER POOL</Text>
            )}
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
  scrollContent: { padding: 14, paddingBottom: 40 },
  
  leagueHeaderCard: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 16, borderRadius: 4, marginBottom: 12 },
  metaLabel: { fontSize: 9, color: '#555', textTransform: 'uppercase', fontWeight: '800', letterSpacing: 0.5, marginBottom: 4 },
  leagueNameText: { color: '#FFF', fontSize: 20, fontWeight: '900' },
  phaseBadge: { alignSelf: 'flex-start', backgroundColor: '#000', borderWidth: 1, borderColor: '#333', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 2, marginTop: 10 },
  phaseBadgeText: { color: '#00ff87', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  enterDraftRoomActionCard: { backgroundColor: '#111', borderRadius: 4, padding: 16, borderLeftWidth: 4, borderColor: '#00ff87', marginBottom: 14, borderWidth: 1, borderTopWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderTopColor: '#222', borderBottomColor: '#222', borderRightColor: '#222' },
  liveIndicatorPulseContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  pulseDotElement: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00ff87', marginRight: 6 },
  liveRoomBadgeText: { color: '#00ff87', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  enterButtonPrimaryText: { color: '#FFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.3 },
  enterButtonSecondarySubtext: { color: '#555', fontSize: 10, fontWeight: '600', marginTop: 3 },

  deadlineCard: { flexDirection: 'row', backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 14, borderRadius: 4, marginBottom: 14, alignItems: 'center', justifyContent: 'space-between' },
  deadlineMetaColumn: { width: '50%' },
  deadlineTitle: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  deadlineSub: { color: '#444', fontSize: 10, fontWeight: '600', marginTop: 2 },
  timerContainer: { backgroundColor: '#1C0F10', borderWidth: 1, borderColor: '#FF3B3033', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 2 },
  timerStringText: { color: '#FF453A', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },

  sectionHeaderTitle: { fontSize: 11, fontWeight: '900', color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, marginLeft: 2, marginTop: 8 },
  statsGridRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  statsCard: { width: '48.5%', backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 14, borderRadius: 4 },
  statsLabel: { color: '#666', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  statsValue: { color: '#FFF', fontSize: 28, fontWeight: '900', marginVertical: 4 },
  statsFooterGreen: { color: '#00ff87', fontSize: 10, fontWeight: '700' },
  statsFooterRed: { color: '#FF1751', fontSize: 10, fontWeight: '700' },
  statsFooterGray: { color: '#444', fontSize: 10, fontWeight: '700' },

  leaderboardContainerCard: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 4, padding: 14, marginBottom: 16 },
  leaderboardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1c1c1c', paddingBottom: 10, marginBottom: 8 },
  leaderboardTitleText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  viewFixturesLinkText: { color: '#00ff87', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    paddingBottom: 6,
    marginBottom: 4,
  },
  thText: {
    color: '#666',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  leaderboardRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 10, 
    borderBottomWidth: 0.5, 
    borderBottomColor: '#1a1a1a' 
  },
  leaderboardRowTopSpot: { 
    backgroundColor: '#121915', 
    borderLeftWidth: 2, 
    borderLeftColor: '#00ff87', 
    paddingLeft: 4 
  },
  rankCol: { width: '10%', alignItems: 'flex-start' },
  rankText: { color: '#666', fontSize: 12, fontWeight: '800' },
  rankTextGold: { color: '#00ff87', fontWeight: '900' },
  managerNameCol: { width: '50%' },
  mNameText: { color: '#DDD', fontSize: 13, fontWeight: '700' },
  fplPointsCol: { width: '20%', alignItems: 'center' },
  h2hPointsCol: { width: '20%', alignItems: 'flex-end' },
  pointsValueText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  h2hValueText: { color: '#00ff87', fontSize: 13, fontWeight: '900' },

  actionGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  actionBtn: { width: '48.5%', backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 16, borderRadius: 4, alignItems: 'center', flexDirection: 'row' },
  actionBtnIcon: { fontSize: 16, marginRight: 10 },
  actionBtnText: { color: '#CCC', fontSize: 12, fontWeight: '800' },

  devCard: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 16, borderRadius: 4, marginTop: 20 },
  devTitle: { color: '#444', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginBottom: 10, letterSpacing: 0.5 },
  syncBtn: { backgroundColor: '#00ff87', paddingVertical: 12, borderRadius: 2, alignItems: 'center' },
  syncBtnText: { color: '#000', fontWeight: '900', fontSize: 11 }
});