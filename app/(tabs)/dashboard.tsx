import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  Dimensions,
  Platform
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { synchronizeFplPlayerPool } from '@/utils/fplSync'; 
import DraftCountdownCard from '@/components/DraftCountdownCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Helper function to handle alerts safely on both Web and Native
const notifyUser = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

interface LeagueMetadata {
  id: string;
  name: string;
  commissioner_id: string;
  draft_status: string;
}

interface UserLeagueMembership {
  league_id: string;
  team_name: string;
  role: string;
  leagues: LeagueMetadata;
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
  const params = useLocalSearchParams<{ leagueId?: string }>();

  const [loading, setLoading] = useState(true);
  const [syncingPool, setSyncingPool] = useState(false); 

  // Multi-League Context State
  const [userLeagues, setUserLeagues] = useState<UserLeagueMembership[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [activeLeagueMeta, setActiveLeagueMeta] = useState<LeagueMetadata | null>(null);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [isPickerModalOpen, setIsPickerModalOpen] = useState(false);

  // Standings & Controls
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
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
  }, [isFocused, params?.leagueId]);

  // 📡 REALTIME DASHBOARD CHANNEL LISTENER WITH SAFE CLEANUP
  useEffect(() => {
    if (!activeLeagueId) return;

    const channel = supabase
      .channel(`dashboard-sync-${activeLeagueId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'league_standings', filter: `league_id=eq.${activeLeagueId}` },
        () => {
          syncDashboardEngine(activeLeagueId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeLeagueId]);

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

    updateClock();
    const clockInterval = setInterval(updateClock, 1000);
    return () => clearInterval(clockInterval);
  }, [targetDeadline]);

  // DRAFT ROOM GATE CHECKER
  useEffect(() => {
    if (!isFocused || !activeLeagueMeta?.id || isDraftCompleted) return;

    const checkGateInterval = setInterval(async () => {
      const { data: settingsData } = await supabase
        .from('league_settings')
        .select('draft_start_time')
        .eq('league_id', activeLeagueId)
        .maybeSingle();

      if (settingsData?.draft_start_time) {
        const targetStartTime = new Date(settingsData.draft_start_time).getTime();
        const msUntilKickoff = targetStartTime - Date.now();
        const tenMinutesInMs = 10 * 60 * 1000;

        if ((msUntilKickoff <= tenMinutesInMs && msUntilKickoff > 0) || activeLeagueMeta.draft_status === 'LIVE') {
          setCanEnterDraftRoom(true);
          clearInterval(checkGateInterval);
        }
      }
    }, 5000);

    return () => clearInterval(checkGateInterval);
  }, [isFocused, activeLeagueId, activeLeagueMeta, isDraftCompleted]);

  const syncDashboardEngine = async (forcedLeagueId?: string) => {
    try {
      setLoading(true);

      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        router.replace('/(auth)/login');
        return;
      }

      const { data: members, error: memberErr } = await supabase
        .from('league_members')
        .select('league_id, team_name, role, leagues ( id, name, commissioner_id, draft_status )')
        .eq('user_id', user.id);

      if (memberErr || !members || members.length === 0) {
        router.replace('/(auth)/onboarding');
        return;
      }

      const formattedMembers = members.map((m: any) => ({
        league_id: m.league_id,
        team_name: m.team_name,
        role: m.role,
        leagues: Array.isArray(m.leagues) ? m.leagues[0] : m.leagues
      })).filter(m => m.leagues) as UserLeagueMembership[];

      if (formattedMembers.length === 0) {
        router.replace('/(auth)/onboarding');
        return;
      }

      setUserLeagues(formattedMembers);

      let storedLid = await AsyncStorage.getItem('active_league_id');
      if (!storedLid && Platform.OS === 'web') {
        storedLid = window.localStorage.getItem('active_league_id');
      }

      const targetLid = forcedLeagueId || params?.leagueId || storedLid || activeLeagueId || formattedMembers[0].league_id;
      const activeMember = formattedMembers.find(m => m.league_id === targetLid) || formattedMembers[0];
      const currentMeta = activeMember.leagues;

      await AsyncStorage.setItem('active_league_id', currentMeta.id);
      if (Platform.OS === 'web') {
        window.localStorage.setItem('active_league_id', currentMeta.id);
      }

      setActiveLeagueId(currentMeta.id);
      setActiveLeagueMeta(currentMeta);
      setIsCommissioner(currentMeta.commissioner_id === user.id);

      const { data: draftSessionData } = await supabase
        .from('draft_sessions')
        .select('draft_status')
        .eq('league_id', currentMeta.id)
        .maybeSingle();

      const draftFinished = draftSessionData?.draft_status === 'COMPLETED' || draftSessionData?.draft_status === 'finished';

      if (draftFinished) {
        setIsDraftCompleted(true);
        setCanEnterDraftRoom(false);
      } else {
        setIsDraftCompleted(false);

        const { data: settingsData } = await supabase
          .from('league_settings')
          .select('draft_start_time')
          .eq('league_id', currentMeta.id)
          .maybeSingle();

        if (settingsData?.draft_start_time) {
          const targetStartTime = new Date(settingsData.draft_start_time).getTime();
          const msUntilKickoff = targetStartTime - Date.now();
          const tenMinutesInMs = 10 * 60 * 1000;

          if ((msUntilKickoff <= tenMinutesInMs && msUntilKickoff > 0) || currentMeta.draft_status === 'LIVE') {
            setCanEnterDraftRoom(true);
          } else {
            setCanEnterDraftRoom(false);
          }
        }
      }

      const { data: standingsData } = await supabase
        .from('league_standings')
        .select('user_id, team_name, total_fantasy_points, league_points')
        .eq('league_id', currentMeta.id)
        .order('league_points', { ascending: false })
        .order('total_fantasy_points', { ascending: false });

      if (standingsData) {
        const ranked: LeaderboardRow[] = standingsData.map((row, index) => ({
          ...row,
          rank: index + 1,
        }));
        setLeaderboard(ranked);
      } else {
        setLeaderboard([]);
      }

      const { data: liveMetrics, error: metricsErr } = await supabase.rpc('get_live_dashboard_metrics', {
        p_league_id: currentMeta.id,
        p_user_id: user.id,
      });

      if (!metricsErr && liveMetrics && liveMetrics.length > 0) {
        const metric = liveMetrics[0];
        setCurrentGameweek(metric.current_gameweek || 1);
        setMyLivePoints(metric.my_live_points || 0);
        setLeagueAveragePoints(metric.league_avg_points || 0);
        setPtsDiff(metric.pts_diff || 0);
      } else {
        setCurrentGameweek(1);
        setMyLivePoints(0);
        setLeagueAveragePoints(0);
        setPtsDiff(0);
      }

      const { data: deadlineData } = await supabase.rpc('get_next_gameweek_deadline');
      if (deadlineData && deadlineData.length > 0) {
        const nextGw = deadlineData[0];
        setNextDeadlineGameweek(nextGw.gameweek || 1);
        if (nextGw.deadline_time) {
          setTargetDeadline(new Date(nextGw.deadline_time));
        }
      }

    } catch (err: any) {
      console.error('❌ [DASHBOARD SYNC ERROR]:', err);
      notifyUser('Dashboard Sync Interrupted', err.message || 'Unable to sync league data.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLeague = async (selectedLeagueId: string) => {
    setIsPickerModalOpen(false);
    await AsyncStorage.setItem('active_league_id', selectedLeagueId);
    if (Platform.OS === 'web') {
      window.localStorage.setItem('active_league_id', selectedLeagueId);
    }
    setActiveLeagueId(selectedLeagueId);
    syncDashboardEngine(selectedLeagueId);
  };

  const handleManualFplSync = async () => {
    try {
      setSyncingPool(true);
      const result = await synchronizeFplPlayerPool();
      
      if (result.success) {
        notifyUser('Data Ingest Complete', `Successfully upserted ${result.count} Premier League assets into Supabase.`);
      } else {
        notifyUser('Sync Process Failure', result.error || 'Sync failed.');
      }
    } catch (err: any) {
      notifyUser('Exception Intercepted', err.message || 'Error occurred during sync.');
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
        {/* LEAGUE HEADER HUB WITH MULTI-LEAGUE SWITCHER */}
        <View style={styles.leagueHeaderCard}>
          <View style={styles.leagueHeaderTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.metaLabel}>Active Context Room</Text>
              <TouchableOpacity 
                style={styles.leagueSelectorTouch} 
                onPress={() => userLeagues.length > 1 && setIsPickerModalOpen(true)}
                activeOpacity={userLeagues.length > 1 ? 0.7 : 1}
              >
                <Text style={styles.leagueNameText}>{activeLeagueMeta?.name || 'Select League...'}</Text>
                {userLeagues.length > 1 && (
                  <Ionicons name="chevron-down" size={16} color="#00ff87" style={{ marginLeft: 6 }} />
                )}
              </TouchableOpacity>
            </View>

            {/* COMMISSIONER SETTINGS BUTTON */}
            {isCommissioner && (
              <TouchableOpacity 
                style={styles.commissionerSettingsBtn} 
                onPress={() => router.push({
                  pathname: '/league-settings',
                  params: { leagueId: activeLeagueId }
                })}
              >
                <Ionicons name="settings-outline" size={14} color="#000" />
                <Text style={styles.commissionerBtnText}>LEAGUE SETTINGS</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.badgeRow}>
            <View style={styles.phaseBadge}>
              <Text style={styles.phaseBadgeText}>
                STATUS: {isDraftCompleted ? '🟢 DRAFT COMPLETED' : activeLeagueMeta?.draft_status === 'LIVE' ? '🔴 DRAFT IN PROGRESS' : '⚙️ ' + (activeLeagueMeta?.draft_status || 'PRE_DRAFT')}
              </Text>
            </View>

            {isCommissioner && (
              <View style={styles.commTag}>
                <Text style={styles.commTagText}>COMMISSIONER</Text>
              </View>
            )}
          </View>
        </View>

        {/* DRAFT ENTRY GUARD */}
        {!isDraftCompleted && (
          canEnterDraftRoom ? (
            <TouchableOpacity 
              style={styles.enterDraftRoomActionCard}
              onPress={() => router.push({ pathname: '/draft-room', params: { leagueId: activeLeagueId } })}
              activeOpacity={0.8}
            >
              <View style={styles.liveIndicatorPulseContainer}>
                <View style={styles.pulseDotElement} />
                <Text style={styles.liveRoomBadgeText}>DRAFT WORKSPACE OPEN</Text>
              </View>
              <Text style={styles.enterButtonPrimaryText}>ENTER LIVE DRAFT ROOM</Text>
              <Text style={styles.enterButtonSecondarySubtext}>Squad selection controls activate at schedule lock</Text>
            </TouchableOpacity>
          ) : (
            <DraftCountdownCard leagueId={activeLeagueId} />
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
            <TouchableOpacity onPress={() => router.push({ pathname: '(tabs)/league/matches', params: { leagueId: activeLeagueId } })}>
              <Text style={styles.viewFixturesLinkText}>VIEW FIXTURES ➔</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tableHeaderRow}>
            <Text style={[styles.thText, { width: '10%' }]}>Rk</Text>
            <Text style={[styles.thText, { width: '50%' }]}>Manager / Team</Text>
            <Text style={[styles.thText, { width: '20%', textAlign: 'center' }]}>FPL Pts</Text>
            <Text style={[styles.thText, { width: '20%', textAlign: 'right' }]}>H2H Pts</Text>
          </View>

          {leaderboard.length === 0 ? (
            <Text style={styles.emptyNoticeText}>No standings computed for this league yet.</Text>
          ) : (
            leaderboard.map((row) => (
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
            ))
          )}
        </View>

        {/* ACTION SHORTCUTS */}
        <Text style={styles.sectionHeaderTitle}>Quick Action Framework</Text>
        <View style={styles.actionGrid}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('(tabs)/players/scout')}>
            <Text style={styles.actionBtnIcon}>🔍</Text>
            <Text style={styles.actionBtnText}>Scout Recruitment</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('(tabs)/players/watchlist')}>
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

      {/* MULTI-LEAGUE SWITCHER MODAL */}
      <Modal visible={isPickerModalOpen} transparent animationType="fade" onRequestClose={() => setIsPickerModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>SWITCH ACTIVE LEAGUE</Text>
            <Text style={styles.modalSub}>Select which fantasy league context to display</Text>
            <FlatList
              data={userLeagues}
              keyExtractor={(item) => item.league_id}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={[
                    styles.leagueOptionRow, 
                    item.league_id === activeLeagueId && styles.leagueOptionActive
                  ]}
                  onPress={() => handleSelectLeague(item.league_id)}
                >
                  <Text style={styles.leagueOptionName}>{item.leagues.name}</Text>
                  <Text style={styles.leagueOptionMeta}>{item.team_name} • {item.role}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.closeModalBtn} onPress={() => setIsPickerModalOpen(false)}>
              <Text style={styles.closeModalText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
  scrollContent: { padding: 14, paddingBottom: 40 },
  
  leagueHeaderCard: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 16, borderRadius: 4, marginBottom: 12 },
  leagueHeaderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  leagueSelectorTouch: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  metaLabel: { fontSize: 9, color: '#555', textTransform: 'uppercase', fontWeight: '800', letterSpacing: 0.5, marginBottom: 2 },
  leagueNameText: { color: '#FFF', fontSize: 20, fontWeight: '900' },
  
  commissionerSettingsBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#00ff87', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 2, gap: 4 },
  commissionerBtnText: { color: '#000', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  phaseBadge: { backgroundColor: '#000', borderWidth: 1, borderColor: '#333', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 2 },
  phaseBadgeText: { color: '#00ff87', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  commTag: { backgroundColor: '#222', borderWidth: 1, borderColor: '#00ff8744', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 2 },
  commTagText: { color: '#FFF', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

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
  emptyNoticeText: { color: '#444', fontSize: 11, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },

  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#222', paddingBottom: 6, marginBottom: 4 },
  thText: { color: '#666', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  leaderboardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  leaderboardRowTopSpot: { backgroundColor: '#121915', borderLeftWidth: 2, borderLeftColor: '#00ff87', paddingLeft: 4 },
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
  syncBtnText: { color: '#000', fontWeight: '900', fontSize: 11 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 20, borderRadius: 4 },
  modalTitle: { color: '#FFF', fontSize: 16, fontWeight: '900' },
  modalSub: { color: '#666', fontSize: 11, marginBottom: 16 },
  leagueOptionRow: { backgroundColor: '#000', padding: 14, borderRadius: 2, marginBottom: 8, borderWidth: 1, borderColor: '#222' },
  leagueOptionActive: { borderColor: '#00ff87', backgroundColor: '#121915' },
  leagueOptionName: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  leagueOptionMeta: { color: '#666', fontSize: 10, marginTop: 2 },
  closeModalBtn: { backgroundColor: '#222', paddingVertical: 12, alignItems: 'center', borderRadius: 2, marginTop: 10 },
  closeModalText: { color: '#888', fontSize: 11, fontWeight: '800' }
});