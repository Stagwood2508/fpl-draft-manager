import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-gifted-charts';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PlayerCardModal from '@/components/PlayerCardModal';
import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

type PeriodMode = 'SEASON' | 'LAST6';
type ProfileTab = 'OVERVIEW' | 'POINTS' | 'H2H' | 'PLAYERS';

interface FormItem {
  gameweek: number;
  score: number;
  opponent_score: number;
  result: 'W' | 'D' | 'L';
}

interface ManagerSummary {
  rank: number;
  user_id: string;
  team_name: string;
  manager_name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  league_points: number;
  total_points: number;
  average_points: number;
  best_score: number;
  worst_score: number;
  benched_points: number;
  expected_wins: number;
  luck_score: number;
  recent_form: FormItem[];
}

interface TrendItem {
  gameweek: number;
  points: number;
  opponent_points: number;
  result: 'WIN' | 'DRAW' | 'LOSS';
  cumulative_points: number;
}

interface H2HItem {
  opponent_id: string;
  opponent_name: string;
  wins: number;
  draws: number;
  losses: number;
  points_for: number;
  points_against: number;
}

interface PlayerContribution {
  player_id: number;
  player_name: string;
  club: string;
  position: string;
  appearances: number;
  minutes: number;
  points: number;
  average_points: number | null;
  points_per_90: number | null;
  goals: number;
  assists: number;
  bonus: number;
}

interface PositionContribution {
  position: string;
  points: number;
}

interface LineupBlunder {
  gameweek: number;
  actual_points: number;
  opponent_points: number;
  optimal_points: number;
  missed_points: number;
}

interface ManagerProfile {
  trends: TrendItem[];
  h2h: H2HItem[];
  players: PlayerContribution[];
  positions: PositionContribution[];
  lineup_blunders: LineupBlunder[];
}

const POSITION_COLORS: Record<string, string> = {
  GKP: '#F6C445', GK: '#F6C445', '1': '#F6C445',
  DEF: '#38A8FF', '2': '#38A8FF',
  MID: '#00E676', '3': '#00E676',
  FWD: '#FF376C', '4': '#FF376C',
};

const normalizePosition = (value: string) => {
  if (value === '1' || value === 'GK') return 'GKP';
  if (value === '2') return 'DEF';
  if (value === '3') return 'MID';
  if (value === '4') return 'FWD';
  return value;
};

export default function LeagueStatsScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { activeLeagueId } = useAppSession();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodMode>('SEASON');
  const [currentGameweek, setCurrentGameweek] = useState(1);
  const [completedGameweeks, setCompletedGameweeks] = useState(0);
  const [managers, setManagers] = useState<ManagerSummary[]>([]);
  const [selectedManager, setSelectedManager] = useState<ManagerSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startGameweek = period === 'LAST6' ? Math.max(1, currentGameweek - 5) : 1;

  const loadStats = useCallback(async (background = false) => {
    if (!activeLeagueId) {
      setManagers([]);
      setCompletedGameweeks(0);
      setLoading(false);
      return;
    }

    try {
      if (!background) setLoading(true);
      setErrorMessage(null);

      const { data: gameweeks, error: gameweekError } = await supabase
        .from('league_gameweeks')
        .select('gameweek, is_current, is_finished')
        .eq('league_id', activeLeagueId)
        .order('gameweek', { ascending: true });
      if (gameweekError) throw gameweekError;

      const rows = gameweeks || [];
      const active = rows.find((row: any) => row.is_current)
        || [...rows].reverse().find((row: any) => row.is_finished)
        || rows[0];
      const resolvedGameweek = Number(active?.gameweek || 1);
      const resolvedStart = period === 'LAST6' ? Math.max(1, resolvedGameweek - 5) : 1;
      setCurrentGameweek(resolvedGameweek);

      const { data, error } = await supabase.rpc('get_league_stats_dashboard', {
        p_league_id: activeLeagueId,
        p_start_gw: resolvedStart,
        p_end_gw: resolvedGameweek,
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || 'Statistics are unavailable.');
      setManagers((data?.managers || []) as ManagerSummary[]);
      setCompletedGameweeks(Number(data?.completed_gameweeks || 0));
    } catch (error: any) {
      setErrorMessage(error?.message || 'League statistics could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeLeagueId, period]);

  useFocusEffect(useCallback(() => { void loadStats(); }, [loadStats]));

  const leagueLeader = managers[0];
  const topScorer = useMemo(() => [...managers].sort((a, b) => b.total_points - a.total_points)[0], [managers]);
  const luckiest = useMemo(() => [...managers].sort((a, b) => b.luck_score - a.luck_score)[0], [managers]);
  const bestGameweek = useMemo(() => [...managers].sort((a, b) => b.best_score - a.best_score)[0], [managers]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, !compact && styles.contentDesktop]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadStats(true); }} tintColor={colors.accent} />}
      >
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.eyebrow}>LEAGUE INTELLIGENCE</Text>
            <Text style={styles.title}>Stats Hub</Text>
          </View>
          <View style={styles.periodSwitch}>
            {(['SEASON', 'LAST6'] as PeriodMode[]).map(option => (
              <TouchableOpacity key={option} style={[styles.periodButton, period === option && styles.periodButtonActive]} onPress={() => setPeriod(option)}>
                <Text style={[styles.periodText, period === option && styles.periodTextActive]}>{option === 'SEASON' ? 'Season' : 'Last 6'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {errorMessage && (
          <TouchableOpacity style={styles.errorBanner} onPress={() => void loadStats()}>
            <Ionicons name="cloud-offline-outline" size={17} color={colors.danger} />
            <Text style={styles.errorText}>{errorMessage} · Tap to retry</Text>
          </TouchableOpacity>
        )}

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={styles.loadingText}>Calculating league records…</Text></View>
        ) : managers.length === 0 || completedGameweeks === 0 ? (
          <View style={styles.emptyCard}><Ionicons name="stats-chart-outline" size={30} color={colors.textMuted} /><Text style={styles.emptyTitle}>No completed match data yet</Text><Text style={styles.emptyText}>This hub will populate as soon as the first gameweek is finalized.</Text></View>
        ) : (
          <>
            <View style={styles.heroGrid}>
              <HeroStat label="League leader" value={leagueLeader?.team_name} detail={`${leagueLeader?.league_points || 0} match pts`} icon="trophy-outline" colors={colors} styles={styles} />
              <HeroStat label="Top scorer" value={topScorer?.team_name} detail={`${topScorer?.total_points || 0} total pts`} icon="flash-outline" colors={colors} styles={styles} />
              <HeroStat label="Best gameweek" value={`${bestGameweek?.best_score || 0} pts`} detail={bestGameweek?.team_name} icon="trending-up-outline" colors={colors} styles={styles} />
              <HeroStat label="Luck leader" value={luckiest?.luck_score > 0 ? `+${luckiest.luck_score}` : `${luckiest?.luck_score || 0}`} detail={luckiest?.team_name} icon="sparkles-outline" colors={colors} styles={styles} />
            </View>

            <View style={styles.sectionHeader}>
              <View><Text style={styles.sectionEyebrow}>MANAGERS</Text><Text style={styles.sectionTitle}>Season profiles</Text></View>
              <Text style={styles.rangeLabel}>GW {startGameweek}–{currentGameweek}</Text>
            </View>

            <View style={[styles.managerGrid, !compact && styles.managerGridDesktop]}>
              {managers.map(manager => (
                <TouchableOpacity key={manager.user_id} activeOpacity={0.82} style={[styles.managerCard, !compact && styles.managerCardDesktop]} onPress={() => setSelectedManager(manager)}>
                  <View style={styles.managerTopRow}>
                    <View style={styles.rankBadge}><Text style={styles.rankText}>{manager.rank}</Text></View>
                    <View style={styles.managerIdentity}><Text style={styles.managerTeam} numberOfLines={1}>{manager.team_name}</Text><Text style={styles.managerName} numberOfLines={1}>{manager.manager_name}</Text></View>
                    <View style={[styles.luckBadge, manager.luck_score < 0 && styles.luckBadgeNegative]}><Text style={[styles.luckText, manager.luck_score < 0 && styles.luckTextNegative]}>{manager.luck_score > 0 ? '+' : ''}{manager.luck_score}</Text></View>
                  </View>
                  <View style={styles.managerStats}>
                    <MiniStat label="Record" value={`${manager.won}-${manager.drawn}-${manager.lost}`} styles={styles} />
                    <MiniStat label="Total" value={`${manager.total_points}`} styles={styles} />
                    <MiniStat label="Avg/GW" value={`${manager.average_points}`} styles={styles} />
                    <MiniStat label="Benched" value={`${manager.benched_points}`} styles={styles} />
                  </View>
                  <View style={styles.formRow}>
                    {(manager.recent_form || []).map(item => <View key={item.gameweek} style={[styles.formDot, item.result === 'W' ? styles.formWin : item.result === 'D' ? styles.formDraw : styles.formLoss]}><Text style={styles.formText}>{item.result}</Text></View>)}
                    <View style={styles.openProfile}><Text style={styles.openProfileText}>VIEW PROFILE</Text><Ionicons name="chevron-forward" size={13} color={colors.accent} /></View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <ManagerProfileModal
        visible={Boolean(selectedManager)} manager={selectedManager} leagueId={activeLeagueId}
        startGameweek={startGameweek} endGameweek={currentGameweek} onClose={() => setSelectedManager(null)}
      />
    </View>
  );
}

function HeroStat({ label, value, detail, icon, colors, styles }: any) {
  return <View style={styles.heroCard}><Ionicons name={icon} size={17} color={colors.accent} /><Text style={styles.heroLabel}>{label}</Text><Text style={styles.heroValue} numberOfLines={1}>{value || '—'}</Text><Text style={styles.heroDetail} numberOfLines={1}>{detail || '—'}</Text></View>;
}

function MiniStat({ label, value, styles }: any) {
  return <View style={styles.miniStat}><Text style={styles.miniValue}>{value}</Text><Text style={styles.miniLabel}>{label}</Text></View>;
}

function ManagerProfileModal({ visible, manager, leagueId, startGameweek, endGameweek, onClose }: { visible: boolean; manager: ManagerSummary | null; leagueId: string | null; startGameweek: number; endGameweek: number; onClose: () => void }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 700;
  const [tab, setTab] = useState<ProfileTab>('OVERVIEW');
  const [profile, setProfile] = useState<ManagerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);

  useEffect(() => {
    if (!visible || !manager || !leagueId) return;
    setTab('OVERVIEW'); setProfile(null); setLoading(true);
    const loadProfile = async () => {
      try {
        const { data, error } = await supabase.rpc('get_manager_stats_profile', { p_league_id: leagueId, p_user_id: manager.user_id, p_start_gw: startGameweek, p_end_gw: endGameweek });
        if (error) throw error;
        if (data?.success === false) throw new Error(data.error);
        setProfile(data as ManagerProfile);
      } catch (error) {
        console.error('[LEAGUE STATS] Manager profile:', error);
      } finally {
        setLoading(false);
      }
    };
    void loadProfile();
  }, [visible, manager?.user_id, leagueId, startGameweek, endGameweek]);

  if (!manager) return null;
  const chartWidth = Math.max(240, Math.min(compact ? width - 72 : 700, 720));

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.profileSheet, { maxHeight: height - Math.max(insets.top, 16) - 16 }, !compact && styles.profileSheetDesktop]}>
            <View style={styles.sheetHandle} />
            <View style={styles.profileHeader}><View><Text style={styles.profileTeam}>{manager.team_name}</Text><Text style={styles.profileManager}>{manager.manager_name}</Text></View><TouchableOpacity style={styles.closeButton} onPress={onClose}><Ionicons name="close" size={21} color={colors.textPrimary} /></TouchableOpacity></View>
            <View style={styles.profileTabs}>{(['OVERVIEW', 'POINTS', 'H2H', 'PLAYERS'] as ProfileTab[]).map(item => <TouchableOpacity key={item} onPress={() => setTab(item)} style={[styles.profileTab, tab === item && styles.profileTabActive]}><Text style={[styles.profileTabText, tab === item && styles.profileTabTextActive]}>{item === 'PLAYERS' ? 'Players' : item.charAt(0) + item.slice(1).toLowerCase()}</Text></TouchableOpacity>)}</View>
            {loading ? <View style={styles.profileLoading}><ActivityIndicator color={colors.accent} /></View> : (
              <ScrollView contentContainerStyle={styles.profileContent}>
                {tab === 'OVERVIEW' && <OverviewTab manager={manager} profile={profile} styles={styles} />}
                {tab === 'POINTS' && <PointsTab profile={profile} chartWidth={chartWidth} colors={colors} styles={styles} />}
                {tab === 'H2H' && <H2HTab profile={profile} styles={styles} />}
                {tab === 'PLAYERS' && <PlayersTab profile={profile} styles={styles} onPlayer={setSelectedPlayerId} />}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
      <PlayerCardModal visible={selectedPlayerId !== null} playerId={selectedPlayerId} leagueId={leagueId} currentGameweek={endGameweek} onClose={() => setSelectedPlayerId(null)} />
    </>
  );
}

function OverviewTab({ manager, profile, styles }: { manager: ManagerSummary; profile: ManagerProfile | null; styles: any }) {
  const best = [...(profile?.trends || [])].sort((a, b) => b.points - a.points)[0];
  const worst = [...(profile?.trends || [])].sort((a, b) => a.points - b.points)[0];
  const blunders = profile?.lineup_blunders || [];
  return <>
    <Text style={styles.blockTitle}>Season record</Text><View style={styles.overviewGrid}><OverviewMetric label="Wins" value={manager.won} tone="good" styles={styles} /><OverviewMetric label="Draws" value={manager.drawn} styles={styles} /><OverviewMetric label="Losses" value={manager.lost} tone="bad" styles={styles} /><OverviewMetric label="Position" value={`#${manager.rank}`} styles={styles} /></View>
    <Text style={styles.blockTitle}>Points summary</Text><View style={styles.overviewGrid}><OverviewMetric label="Match pts" value={manager.league_points} styles={styles} /><OverviewMetric label="Total pts" value={manager.total_points} styles={styles} /><OverviewMetric label="Avg/GW" value={manager.average_points} styles={styles} /><OverviewMetric label="Benched" value={manager.benched_points} tone="warn" styles={styles} /></View>
    <Text style={styles.blockTitle}>Gameweek extremes</Text><View style={styles.extremesRow}><OverviewMetric label={best ? `Best · GW${best.gameweek}` : 'Best GW'} value={best?.points ?? manager.best_score} tone="good" styles={styles} /><OverviewMetric label={worst ? `Worst · GW${worst.gameweek}` : 'Worst GW'} value={worst?.points ?? manager.worst_score} tone="bad" styles={styles} /></View>
    <Text style={styles.blockTitle}>Fixture luck</Text><View style={styles.luckPanel}><Text style={[styles.luckBig, manager.luck_score < 0 && styles.luckBigBad]}>{manager.luck_score > 0 ? '+' : ''}{manager.luck_score}</Text><Text style={styles.luckDescription}>Actual results versus the share of league managers this score would normally beat.</Text><Text style={styles.expectedText}>{manager.won} actual wins · {manager.expected_wins} expected wins</Text></View>
    <Text style={styles.blockTitle}>Lineup blunders</Text>
    <View style={styles.blunderPanel}>
      <View style={styles.blunderSummary}>
        <Text style={[styles.blunderCount, blunders.length === 0 && styles.valueGood]}>{blunders.length}</Text>
        <Text style={styles.blunderSummaryText}>{blunders.length === 0 ? 'No losses could have become wins with a different legal XI.' : `${blunders.length === 1 ? 'loss' : 'losses'} could have become wins with a different legal XI.`}</Text>
      </View>
      {blunders.map(item => <View key={item.gameweek} style={styles.blunderRow}><Text style={styles.blunderGameweek}>GW{item.gameweek}</Text><Text style={styles.blunderDetail}>{item.actual_points}-{item.opponent_points} actual</Text><Text style={styles.blunderPotential}>{item.optimal_points} possible</Text></View>)}
    </View>
  </>;
}

function OverviewMetric({ label, value, tone, styles }: any) { return <View style={styles.overviewMetric}><Text style={[styles.overviewValue, tone === 'good' && styles.valueGood, tone === 'bad' && styles.valueBad, tone === 'warn' && styles.valueWarn]}>{value}</Text><Text style={styles.overviewLabel}>{label}</Text></View>; }

function PointsTab({ profile, chartWidth, colors, styles }: any) {
  const trends: TrendItem[] = profile?.trends || [];
  if (!trends.length) return <EmptyProfile text="No completed gameweek scores in this range." styles={styles} />;
  const weekly = trends.map(item => ({ value: item.points, label: `${item.gameweek}`, dataPointColor: item.result === 'WIN' ? colors.accent : item.result === 'LOSS' ? colors.danger : colors.textMuted }));
  const cumulative = trends.map(item => ({ value: item.cumulative_points, label: `${item.gameweek}` }));
  return <><Text style={styles.blockTitle}>Points per gameweek</Text><View style={styles.chartCard}><LineChart data={weekly} width={chartWidth} height={190} color={colors.accent} thickness={2} noOfSections={4} yAxisColor={colors.border} xAxisColor={colors.border} rulesColor={colors.border} yAxisTextStyle={{ color: colors.textMuted, fontSize: 9 }} xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 8 }} /></View><Text style={styles.blockTitle}>Cumulative points</Text><View style={styles.chartCard}><LineChart data={cumulative} width={chartWidth} height={190} color="#B44CFF" thickness={3} hideDataPoints noOfSections={4} yAxisColor={colors.border} xAxisColor={colors.border} rulesColor={colors.border} yAxisTextStyle={{ color: colors.textMuted, fontSize: 9 }} xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 8 }} /></View></>;
}

function H2HTab({ profile, styles }: any) {
  const rows: H2HItem[] = profile?.h2h || [];
  if (!rows.length) return <EmptyProfile text="No head-to-head results in this range." styles={styles} />;
  return <>{rows.map(item => <View key={item.opponent_id} style={styles.h2hRow}><View style={styles.h2hIdentity}><Text style={styles.h2hName}>vs {item.opponent_name}</Text><Text style={styles.h2hPoints}>PF {item.points_for} · PA {item.points_against}</Text></View><Text style={styles.h2hRecord}>{item.wins}W–{item.draws}D–{item.losses}L</Text></View>)}</>;
}

function PlayersTab({ profile, styles, onPlayer }: any) {
  const players: PlayerContribution[] = profile?.players || [];
  const positions: PositionContribution[] = profile?.positions || [];
  if (!players.length) return <EmptyProfile text="Player contribution data will appear after lineups are finalized." styles={styles} />;
  return <><Text style={styles.blockTitle}>By position</Text><View style={styles.positionGrid}>{positions.map(item => { const position = normalizePosition(item.position); const total = players.reduce((sum, player) => sum + player.points, 0); return <View key={position} style={styles.positionCard}><Text style={[styles.positionPoints, { color: POSITION_COLORS[position] }]}>{item.points}</Text><Text style={styles.positionLabel}>{position}</Text><Text style={styles.positionShare}>{total ? Math.round(item.points / total * 100) : 0}%</Text></View>; })}</View><Text style={styles.blockTitle}>Player contributions</Text>{players.map((player, index) => { const pos = normalizePosition(player.position); return <TouchableOpacity key={player.player_id} style={styles.playerRow} onPress={() => onPlayer(player.player_id)}><View style={styles.playerRank}><Text style={styles.playerRankText}>{index + 1}</Text></View><View style={styles.playerIdentity}><View style={styles.playerNameRow}><Text style={styles.playerName}>{player.player_name}</Text><View style={[styles.positionChip, { backgroundColor: POSITION_COLORS[pos] }]}><Text style={styles.positionChipText}>{pos}</Text></View></View><Text style={styles.playerMeta}>{player.appearances} apps · {player.average_points ?? 0} avg · {player.points_per_90 ?? 0}/90 · {player.club}</Text></View><View style={styles.playerPoints}><Text style={styles.playerPointsValue}>{player.points}</Text><Text style={styles.playerPointsLabel}>PTS</Text></View></TouchableOpacity>; })}</>;
}

function EmptyProfile({ text, styles }: any) { return <View style={styles.profileEmpty}><Text style={styles.emptyText}>{text}</Text></View>; }

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: appSpacing.md, paddingBottom: 36 }, contentDesktop: { width: '100%', maxWidth: 1180, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: appSpacing.md }, eyebrow: { ...appTypography.label, color: colors.accent }, title: { ...appTypography.screenTitle, color: colors.textPrimary, marginTop: 2 },
  periodSwitch: { flexDirection: 'row', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.pill, padding: 3 }, periodButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: appRadius.pill }, periodButtonActive: { backgroundColor: colors.accent }, periodText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' }, periodTextActive: { color: colors.black },
  errorBanner: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: appRadius.medium, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerBorder, marginBottom: 12 }, errorText: { flex: 1, color: colors.danger, fontWeight: '700', fontSize: 12 },
  loading: { minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 10 }, loadingText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  emptyCard: { minHeight: 280, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.large, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: 24 }, emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '900', marginTop: 10 }, emptyText: { color: colors.textMuted, textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 5 },
  heroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, heroCard: { flexGrow: 1, flexBasis: 150, minWidth: 145, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium, padding: 13 }, heroLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginTop: 8 }, heroValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 2 }, heroDetail: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 22, marginBottom: 10 }, sectionEyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }, sectionTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' }, rangeLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  managerGrid: { gap: 8 }, managerGridDesktop: { flexDirection: 'row', flexWrap: 'wrap' }, managerCard: { backgroundColor: colors.surface, borderRadius: appRadius.medium, borderWidth: 1, borderColor: colors.border, padding: 12 }, managerCardDesktop: { width: '49%', flexGrow: 1 }, managerTopRow: { flexDirection: 'row', alignItems: 'center' }, rankBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, rankText: { color: colors.accent, fontSize: 13, fontWeight: '900' }, managerIdentity: { flex: 1, minWidth: 0, paddingHorizontal: 10 }, managerTeam: { color: colors.textPrimary, fontSize: 14, fontWeight: '900' }, managerName: { color: colors.textMuted, fontSize: 11, marginTop: 1 }, luckBadge: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: appRadius.pill, paddingHorizontal: 9, paddingVertical: 4 }, luckBadgeNegative: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder }, luckText: { color: colors.accent, fontSize: 11, fontWeight: '900' }, luckTextNegative: { color: colors.danger },
  managerStats: { flexDirection: 'row', marginTop: 12, backgroundColor: colors.backgroundElevated, borderRadius: appRadius.small, paddingVertical: 9 }, miniStat: { flex: 1, alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }, miniValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '900' }, miniLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '700', marginTop: 1 }, formRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 }, formDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, formWin: { backgroundColor: colors.accent }, formDraw: { backgroundColor: colors.textMuted }, formLoss: { backgroundColor: colors.danger }, formText: { color: colors.black, fontSize: 9, fontWeight: '900' }, openProfile: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 2 }, openProfileText: { color: colors.accent, fontSize: 9, fontWeight: '900' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.68)', justifyContent: 'flex-end', alignItems: 'center' }, profileSheet: { width: '100%', backgroundColor: colors.backgroundElevated, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }, profileSheetDesktop: { width: 820, borderRadius: 24, marginBottom: 24 }, sheetHandle: { width: 54, height: 5, borderRadius: 3, backgroundColor: colors.textMuted, alignSelf: 'center', marginTop: 10 }, profileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }, profileTeam: { color: colors.textPrimary, fontSize: 21, fontWeight: '900' }, profileManager: { color: colors.textSecondary, fontSize: 13, marginTop: 2 }, closeButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  profileTabs: { flexDirection: 'row', padding: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border }, profileTab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: appRadius.pill }, profileTabActive: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.borderStrong }, profileTabText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' }, profileTabTextActive: { color: colors.textPrimary }, profileLoading: { minHeight: 320, justifyContent: 'center' }, profileContent: { padding: 16, paddingBottom: 28 },
  blockTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 8, marginBottom: 8 }, overviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, overviewMetric: { flexGrow: 1, flexBasis: 92, minWidth: 82, backgroundColor: colors.surface, borderRadius: appRadius.medium, borderWidth: 1, borderColor: colors.border, padding: 12, alignItems: 'center' }, overviewValue: { color: colors.textPrimary, fontSize: 22, fontWeight: '900' }, overviewLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', marginTop: 3 }, valueGood: { color: colors.accent }, valueBad: { color: colors.danger }, valueWarn: { color: '#FF9F43' }, extremesRow: { flexDirection: 'row', gap: 8 }, luckPanel: { backgroundColor: colors.surface, borderRadius: appRadius.medium, borderWidth: 1, borderColor: colors.border, alignItems: 'center', padding: 18 }, luckBig: { color: colors.accent, fontSize: 34, fontWeight: '900' }, luckBigBad: { color: colors.danger }, luckDescription: { color: colors.textSecondary, textAlign: 'center', fontSize: 11, lineHeight: 17, maxWidth: 440, marginTop: 4 }, expectedText: { color: colors.textMuted, fontSize: 11, fontWeight: '700', marginTop: 10 },
  blunderPanel: { backgroundColor: colors.surface, borderRadius: appRadius.medium, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 }, blunderSummary: { flexDirection: 'row', alignItems: 'center', gap: 12 }, blunderCount: { color: colors.danger, fontSize: 30, fontWeight: '900' }, blunderSummaryText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 17 }, blunderRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }, blunderGameweek: { color: colors.textPrimary, fontSize: 11, fontWeight: '900', width: 48 }, blunderDetail: { flex: 1, color: colors.textMuted, fontSize: 11 }, blunderPotential: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  chartCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium, paddingHorizontal: 8, paddingVertical: 14, overflow: 'hidden' }, h2hRow: { flexDirection: 'row', alignItems: 'center', padding: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium, marginBottom: 7 }, h2hIdentity: { flex: 1 }, h2hName: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' }, h2hPoints: { color: colors.textMuted, fontSize: 10, marginTop: 2 }, h2hRecord: { color: colors.accent, fontSize: 13, fontWeight: '900' },
  positionGrid: { flexDirection: 'row', gap: 6 }, positionCard: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium, paddingVertical: 10, alignItems: 'center' }, positionPoints: { fontSize: 18, fontWeight: '900' }, positionLabel: { color: colors.textPrimary, fontSize: 10, fontWeight: '800', marginTop: 2 }, positionShare: { color: colors.textMuted, fontSize: 9 }, playerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10, paddingHorizontal: 8 }, playerRank: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.backgroundElevated, alignItems: 'center', justifyContent: 'center' }, playerRankText: { color: colors.textMuted, fontSize: 10, fontWeight: '900' }, playerIdentity: { flex: 1, minWidth: 0, marginLeft: 9 }, playerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, playerName: { color: colors.textPrimary, fontSize: 13, fontWeight: '900' }, positionChip: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 }, positionChipText: { color: '#071019', fontSize: 8, fontWeight: '900' }, playerMeta: { color: colors.textMuted, fontSize: 10, marginTop: 2 }, playerPoints: { alignItems: 'flex-end', marginLeft: 8 }, playerPointsValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '900' }, playerPointsLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800' }, profileEmpty: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
});
