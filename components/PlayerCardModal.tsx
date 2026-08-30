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
  TextInput,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import PlayerHeadshot from '@/components/PlayerHeadshot';
import { AppColors } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

interface PlayerDetails {
  id: number;
  code?: number;
  photo_code?: number;
  web_name: string;
  first_name: string;
  second_name: string;
  element_type: 'GKP' | 'DEF' | 'MID' | 'FWD' | string;
  team_id?: number;
  team_name: string;
  team_short_name?: string;
  total_points: number;
  minutes?: number;
  goals_scored?: number;
  assists?: number;
  clean_sheets?: number;
  yellow_cards?: number;
  red_cards?: number;
  form?: string;
  points_per_game?: string;
  starts?: number;
  bonus?: number;
  saves?: number;
  penalties_saved?: number;
  goals_conceded?: number;
  influence?: string | number;
  creativity?: string | number;
  threat?: string | number;
  ict_index?: string | number;
  expected_goals?: string | number;
  expected_assists?: string | number;
  clearances_blocks_interceptions?: number;
  recoveries?: number;
  tackles?: number;
  defensive_contribution?: number;
  season_name?: string;
  owner_name?: string | null;
}

interface GameweekStat {
  gameweek: number;
  minutes: number;
  goals: number;
  assists: number;
  clean_sheets: number;
  cbit_points: number;
  total_points: number;
  opponent_short: string;
  is_home: boolean;
  score_display: string;
  opponent_display: string;
}

interface UpcomingFixture {
  gameweek: number;
  opponent_short: string;
  is_home: boolean;
  fdr: number; // 1 (Easy) to 5 (Hard)
}

interface PlayerCardModalProps {
  visible: boolean;
  playerId: number | null;
  leagueId: string | null;
  currentGameweek?: number;
  statsMode?: 'CURRENT' | 'LAST_SEASON';
  seasonLabel?: string;
  transferListing?: {
    isListed: boolean;
    note: string | null;
    saving?: boolean;
    onSave: (note: string | null) => void | Promise<void>;
    onRemove: () => void | Promise<void>;
  };
  onClose: () => void;
}

const getPreviousSeasonLabel = () => {
  const now = new Date();
  const endingYear = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${endingYear - 1}/${String(endingYear).slice(-2)}`;
};

const displayStat = (value: string | number | null | undefined, suffix = '') => {
  if (value === null || value === undefined || value === '') return '—';
  return `${value}${suffix}`;
};

const POSITION_COLORS: Record<string, string> = {
  GKP: '#FFC107',
  DEF: '#00A2FF',
  MID: '#00FF87',
  FWD: '#FF0055',
};

const FDR_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: '#00FF87', text: '#000000' }, // Very Easy
  2: { bg: '#01FC7A', text: '#000000' }, // Easy
  3: { bg: '#E7E7E7', text: '#000000' }, // Moderate
  4: { bg: '#FF1751', text: '#FFFFFF' }, // Tough
  5: { bg: '#80072D', text: '#FFFFFF' }, // Extreme
};

export default function PlayerCardModal({
  visible,
  playerId,
  leagueId,
  currentGameweek = 0,
  statsMode = 'CURRENT',
  seasonLabel,
  transferListing,
  onClose,
}: PlayerCardModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const isMobileLayout = width < 700;
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'HISTORY' | 'SCHEDULE' | 'TRANSFER'>('OVERVIEW');
  const [loading, setLoading] = useState<boolean>(true);
  const [player, setPlayer] = useState<PlayerDetails | null>(null);
  const [history, setHistory] = useState<GameweekStat[]>([]);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<UpcomingFixture[]>([]);
  const [lastSeasonAvailable, setLastSeasonAvailable] = useState<boolean>(true);
  const [tradeNoteText, setTradeNoteText] = useState('');

  useEffect(() => {
    if (visible && playerId) {
      loadPlayerData();
    } else {
      setActiveTab('OVERVIEW');
      setPlayer(null);
      setHistory([]);
      setHistoryLoadError(null);
      setSchedule([]);
      setLastSeasonAvailable(true);
    }
  }, [visible, playerId, leagueId, currentGameweek, statsMode]);

  useEffect(() => {
    if (visible && transferListing) {
      setTradeNoteText(transferListing.note || '');
    }
  }, [playerId, transferListing?.isListed, transferListing?.note, visible]);

  const loadPlayerData = async () => {
    if (!playerId) return;
    try {
      setLoading(true);
      setLastSeasonAvailable(true);
      setHistoryLoadError(null);

      // Resolve Active League ID from prop > AsyncStorage fallback
      let activeLid = leagueId;
      if (!activeLid) {
        activeLid = await AsyncStorage.getItem('active_league_id');
      }

      // 1. Fetch Player Base Info
      const { data: playerData, error: pErr } = await supabase
        .from('players')
        .select('*')
        .eq('id', playerId)
        .single();

      if (pErr) throw pErr;

      let ownerDisplayName: string | null = null;
      let effectivePosition = playerData.element_type;

      if (activeLid) {
        // Fetch positional override for active league
        const { data: overrideData } = await supabase
          .from('league_player_overrides')
          .select('custom_position')
          .eq('league_id', activeLid)
          .eq('player_id', playerId)
          .maybeSingle();

        if (overrideData?.custom_position) {
          effectivePosition = overrideData.custom_position;
        }

        // Fetch ownership in active league
        const { data: rosterData } = await supabase
          .from('rosters')
          .select('user_id')
          .eq('league_id', activeLid)
          .eq('player_id', Number(playerId))
          .maybeSingle();

        if (rosterData?.user_id) {
          const { data: memberData } = await supabase
            .from('league_members')
            .select('team_name')
            .eq('league_id', activeLid)
            .eq('user_id', rosterData.user_id)
            .maybeSingle();

          if (memberData?.team_name) {
            ownerDisplayName = memberData.team_name;
          } else {
            const { data: profileData } = await supabase
              .from('profiles')
              .select('display_name, first_name, last_name')
              .eq('id', rosterData.user_id)
              .maybeSingle();

            if (profileData) {
              ownerDisplayName =
                profileData.display_name ||
                (profileData.first_name ? `${profileData.first_name} ${profileData.last_name ?? ''}` : 'Manager');
            } else {
              ownerDisplayName = `Manager ${rosterData.user_id.slice(0, 4).toUpperCase()}`;
            }
          }
        }
      }

      const basePlayer: PlayerDetails = {
        ...playerData,
        element_type: effectivePosition,
        team_short_name: playerData.team_short_name || (playerData.team_name ? playerData.team_name.slice(0, 3).toUpperCase() : 'PL'),
        owner_name: ownerDisplayName,
      };

      if (statsMode === 'LAST_SEASON') {
        const requestedSeason = seasonLabel || getPreviousSeasonLabel();
        const { data: seasonData, error: seasonError } = await supabase
          .from('player_season_stats')
          .select('*')
          .eq('player_code', playerData.code)
          .eq('season_name', requestedSeason)
          .maybeSingle();

        if (seasonError) throw seasonError;

        if (seasonData) {
          const starts = Number(seasonData.starts || 0);
          setLastSeasonAvailable(true);
          setPlayer({
            ...basePlayer,
            ...seasonData,
            id: basePlayer.id,
            code: basePlayer.code,
            photo_code: basePlayer.photo_code,
            web_name: basePlayer.web_name,
            first_name: basePlayer.first_name,
            second_name: basePlayer.second_name,
            element_type: basePlayer.element_type,
            team_id: basePlayer.team_id,
            team_name: basePlayer.team_name,
            team_short_name: basePlayer.team_short_name,
            owner_name: basePlayer.owner_name,
            points_per_game: starts > 0
              ? (Number(seasonData.total_points || 0) / starts).toFixed(1)
              : undefined,
          });
        } else {
          setLastSeasonAvailable(false);
          setPlayer(basePlayer);
        }
      } else {
        const { data: currentStatsData, error: currentStatsError } = await supabase
          .rpc('get_player_pool_current_stats', {
            p_through_gameweek: Math.max(currentGameweek, 1),
          })
          .eq('player_id', playerId)
          .maybeSingle();

        if (currentStatsError) {
          console.warn('Current player-card aggregates unavailable:', currentStatsError.message);
        }

        const currentStats = currentStatsData as any;
        const appearances = Number(currentStats?.appearances || currentStats?.starts || 0);
        const currentTotal = Number(currentStats?.total_points || 0);

        setPlayer({
          ...basePlayer,
          total_points: currentTotal,
          minutes: Number(currentStats?.minutes || 0),
          starts: Number(currentStats?.starts || 0),
          goals_scored: Number(currentStats?.goals_scored || 0),
          assists: Number(currentStats?.assists || 0),
          clean_sheets: Number(currentStats?.clean_sheets || 0),
          saves: Number(currentStats?.saves || 0),
          penalties_saved: Number(currentStats?.penalties_saved || 0),
          bonus: Number(currentStats?.bonus || 0),
          defensive_contribution: Number(currentStats?.defensive_contribution || 0),
          ict_index: Number(currentStats?.ict_index || 0),
          expected_goals: Number(currentStats?.expected_goals || 0),
          expected_assists: Number(currentStats?.expected_assists || 0),
          form: String(Number(currentStats?.recent_form || 0)),
          points_per_game: appearances > 0 ? (currentTotal / appearances).toFixed(1) : '0.0',
        });
      }

      if (statsMode === 'CURRENT') {
        // 2. Fetch scoring history using the resolved league. On native the
        // prop can briefly be empty while the persisted active league is
        // restored, even though activeLid has already resolved successfully.
        let statsData: any[] | null = null;
        if (!activeLid) {
          setHistoryLoadError('Select an active league to view scoring history.');
        } else {
          const { data, error: historyError } = await supabase
            .rpc('get_player_gameweek_history', {
              p_league_id: activeLid,
              p_player_id: playerId,
              p_through_gameweek: currentGameweek > 0 ? currentGameweek : 38,
            });

          if (historyError) {
            console.warn('Player scoring history unavailable:', historyError.message);
            setHistoryLoadError('Scoring history could not be loaded. Please try again.');
          } else {
            statsData = data || [];
          }
        }

        if (statsData) {
          const historyGameweeks = [...new Set(statsData.map((row: any) => Number(row.gameweek)))];
          const { data: playedFixtures, error: fixturesHistoryError } = historyGameweeks.length > 0
            ? await supabase
                .from('fixtures')
                .select('gameweek, home_team_id, away_team_id, home_team_short, away_team_short, home_score, away_score, kickoff_time')
                .in('gameweek', historyGameweeks)
                .or(`home_team_id.eq.${playerData.team_id},away_team_id.eq.${playerData.team_id}`)
                .order('kickoff_time', { ascending: true })
            : { data: [], error: null };

          if (fixturesHistoryError) {
            // The scoring rows remain useful even if the opponent/result
            // enrichment is temporarily unavailable.
            console.warn('Fixture labels unavailable for player scoring history:', fixturesHistoryError.message);
          }

          const fixturesByGameweek = new Map<number, any[]>();
          (fixturesHistoryError ? [] : (playedFixtures || [])).forEach((fixture: any) => {
            const rows = fixturesByGameweek.get(Number(fixture.gameweek)) || [];
            rows.push(fixture);
            fixturesByGameweek.set(Number(fixture.gameweek), rows);
          });

          const formattedHistory: GameweekStat[] = statsData.map((row: any) => {
            const gameweekFixtures = fixturesByGameweek.get(Number(row.gameweek)) || [];
            const firstFixture = gameweekFixtures[0];
            const isHome = firstFixture ? Number(firstFixture.home_team_id) === Number(playerData.team_id) : false;
            const opponentDisplay = gameweekFixtures.length > 0
              ? gameweekFixtures.map((fixture: any) => {
                  const home = Number(fixture.home_team_id) === Number(playerData.team_id);
                  return `${home ? 'vs' : '@'} ${home ? fixture.away_team_short : fixture.home_team_short}`;
                }).join(' / ')
              : 'Fixture unavailable';
            const score = gameweekFixtures.length > 0
              ? gameweekFixtures.map((fixture: any) => `${fixture.home_score ?? 0}-${fixture.away_score ?? 0}`).join(' / ')
              : '—';

            return {
              gameweek: row.gameweek,
              minutes: row.minutes || 0,
              goals: row.goals_scored || 0,
              assists: row.assists || 0,
              clean_sheets: row.clean_sheets || 0,
              cbit_points: row.defcon_points || 0,
              total_points: row.total_points || 0,
              opponent_short: firstFixture
                ? (isHome ? firstFixture.away_team_short : firstFixture.home_team_short)
                : '—',
              is_home: isHome,
              score_display: score,
              opponent_display: opponentDisplay,
            };
          });
          setHistory(formattedHistory);
        }

        // 3. Fetch Upcoming Schedule (FDR)
        const { data: fixtureData } = await supabase
          .from('fixtures')
          .select('*')
          .or(`home_team_id.eq.${playerData.team_id},away_team_id.eq.${playerData.team_id}`)
          .gt('gameweek', currentGameweek)
          .order('gameweek', { ascending: true })
          .limit(6);

        if (fixtureData) {
          const formattedSchedule: UpcomingFixture[] = fixtureData.map((fix: any) => {
            const isHome = fix.home_team_id === playerData.team_id;
            return {
              gameweek: fix.gameweek,
              opponent_short: isHome ? fix.away_team_short || 'OPP' : fix.home_team_short || 'OPP',
              is_home: isHome,
              fdr: isHome ? fix.home_difficulty || 3 : fix.away_difficulty || 3,
            };
          });
          setSchedule(formattedSchedule);
        }
      }
    } catch (err: any) {
      Alert.alert('Error Loading Player Card', err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={true} presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.overlay, isMobileLayout && styles.overlayMobile]}>
        <View style={[styles.cardContainer, isMobileLayout && styles.cardContainerMobile, isMobileLayout && { paddingTop: Math.max(safeArea.top, 8), paddingBottom: Math.max(safeArea.bottom, 8) }]}>
          
          {/* TOP BAR / OWNERSHIP BADGE */}
          <View style={styles.topBar}>
            <View style={styles.ownershipBadge}>
              <Ionicons
                name={player?.owner_name ? 'shield' : 'people'}
                size={12}
                color={player?.owner_name ? colors.warning : colors.accent}
              />
              <Text style={styles.ownershipText}>
                {player?.owner_name ? `OWNED BY ${player.owner_name.toUpperCase()}` : 'FREE AGENT'}
              </Text>
            </View>
          </View>

          {/* HERO HEADER WITH PLAYER HEADSHOT */}
          {player && (
            <View style={styles.heroSection}>
              <View style={styles.avatarWrapper}>
                <PlayerHeadshot
                  code={player.code}
                  photoCode={player.photo_code}
                  teamId={player.team_id}
                  style={styles.playerPhoto}
                  fallbackSize={42}
                />
              </View>

              <View style={styles.heroMain}>
                <Text style={styles.playerName}>{player.web_name}</Text>
                <Text style={styles.playerMeta}>
                  {player.first_name} {player.second_name} • {player.team_name}
                </Text>
              </View>
              <View
                style={[
                  styles.positionBadge,
                  { backgroundColor: POSITION_COLORS[player.element_type] || '#222' },
                ]}
              >
                <Text style={styles.positionBadgeText}>{player.element_type}</Text>
              </View>
            </View>
          )}

          {/* TAB NAVIGATION HEADER */}
          {statsMode === 'CURRENT' ? <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'OVERVIEW' && styles.tabBtnActive]}
              onPress={() => setActiveTab('OVERVIEW')}
            >
              <Text style={[styles.tabText, activeTab === 'OVERVIEW' && styles.tabTextActive]}>OVERVIEW</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'HISTORY' && styles.tabBtnActive]}
              onPress={() => setActiveTab('HISTORY')}
            >
              <Text
                style={[styles.tabText, styles.scoringHistoryTabText, activeTab === 'HISTORY' && styles.tabTextActive]}
                numberOfLines={1}
              >
                SCORING HISTORY
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'SCHEDULE' && styles.tabBtnActive]}
              onPress={() => setActiveTab('SCHEDULE')}
            >
              <Text style={[styles.tabText, activeTab === 'SCHEDULE' && styles.tabTextActive]}>FIXTURES</Text>
            </TouchableOpacity>
            {transferListing && (
              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'TRANSFER' && styles.tabBtnActive]}
                onPress={() => setActiveTab('TRANSFER')}
              >
                <Text style={[styles.tabText, activeTab === 'TRANSFER' && styles.tabTextActive]}>
                  {transferListing.isListed ? 'LISTED' : 'TRANSFER'}
                </Text>
              </TouchableOpacity>
            )}
          </View> : (
            <View style={styles.seasonBanner}>
              <Ionicons name="stats-chart" size={14} color={colors.accent} />
              <Text style={styles.seasonBannerText}>
                {seasonLabel || getPreviousSeasonLabel()} LAST-SEASON STATS
              </Text>
            </View>
          )}

          {/* CONTENT BODY */}
          {loading ? (
            <View style={styles.loaderBox}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : (
            <View style={[styles.bodyContainer, isMobileLayout && styles.bodyContainerMobile]}>
              
              {/* TAB 1: OVERVIEW & STATS */}
              {activeTab === 'OVERVIEW' && player && statsMode === 'LAST_SEASON' && !lastSeasonAvailable && (
                <View style={styles.historyUnavailable}>
                  <Ionicons name="calendar-outline" size={28} color={colors.textMuted} />
                  <Text style={styles.historyUnavailableTitle}>
                    NO {seasonLabel || getPreviousSeasonLabel()} PREMIER LEAGUE HISTORY
                  </Text>
                  <Text style={styles.historyUnavailableCopy}>
                    This player has no official FPL record for that season. This is expected for new signings and players promoted into the league.
                  </Text>
                </View>
              )}

              {activeTab === 'OVERVIEW' && player && (statsMode !== 'LAST_SEASON' || lastSeasonAvailable) && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* KPI Summary Grid */}
                  <View style={styles.kpiGrid}>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiValue}>{displayStat(player.total_points)}</Text>
                      <Text style={styles.kpiLabel}>TOTAL PTS</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiValue}>{displayStat(player.points_per_game)}</Text>
                      <Text style={styles.kpiLabel}>{statsMode === 'LAST_SEASON' ? 'PTS / START' : 'AVG / MATCH'}</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiValue}>
                        {statsMode === 'LAST_SEASON' ? displayStat(player.starts) : displayStat(player.form)}
                      </Text>
                      <Text style={styles.kpiLabel}>{statsMode === 'LAST_SEASON' ? 'STARTS' : 'FORM'}</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiValue}>{displayStat(player.minutes, "'")}</Text>
                      <Text style={styles.kpiLabel}>MINUTES</Text>
                    </View>
                  </View>

                  <Text style={styles.sectionHeader}>
                    {player.element_type === 'GKP' ? 'Goalkeeping Performance' : 'Matchday Return Metrics'}
                  </Text>
                  <View style={styles.statsBox}>
                    {player.element_type !== 'GKP' && (
                      <>
                        <View style={styles.statRow}>
                          <Text style={styles.statLabel}>Goals Scored</Text>
                          <Text style={styles.statVal}>{displayStat(player.goals_scored)}</Text>
                        </View>
                        <View style={styles.statRow}>
                          <Text style={styles.statLabel}>Assists</Text>
                          <Text style={styles.statVal}>{displayStat(player.assists)}</Text>
                        </View>
                      </>
                    )}
                    {player.element_type !== 'FWD' && (
                      <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Clean Sheets</Text>
                        <Text style={styles.statVal}>{displayStat(player.clean_sheets)}</Text>
                      </View>
                    )}
                    {player.element_type === 'GKP' && (
                      <>
                        <View style={styles.statRow}>
                          <Text style={styles.statLabel}>Saves</Text>
                          <Text style={styles.statVal}>{displayStat(player.saves)}</Text>
                        </View>
                        <View style={styles.statRow}>
                          <Text style={styles.statLabel}>Penalties Saved</Text>
                          <Text style={styles.statVal}>{displayStat(player.penalties_saved)}</Text>
                        </View>
                        <View style={styles.statRow}>
                          <Text style={styles.statLabel}>Goals Conceded</Text>
                          <Text style={styles.statVal}>{displayStat(player.goals_conceded)}</Text>
                        </View>
                      </>
                    )}
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Yellow / Red Cards</Text>
                      <Text style={styles.statVal}>
                        {displayStat(player.yellow_cards)} / {displayStat(player.red_cards)}
                      </Text>
                    </View>
                  </View>

                  {statsMode === 'LAST_SEASON' && (
                    <>
                      <Text style={styles.sectionHeader}>FPL Scouting Indexes</Text>
                      <View style={styles.ictHeroCard}>
                        <View>
                          <Text style={styles.ictHeroLabel}>ICT INDEX</Text>
                          <Text style={styles.ictHeroValue}>{displayStat(player.ict_index)}</Text>
                        </View>
                        <View style={styles.ictBreakdown}>
                          <View style={styles.ictBreakdownItem}>
                            <Text style={styles.ictBreakdownValue}>{displayStat(player.influence)}</Text>
                            <Text style={styles.ictBreakdownLabel}>INFLUENCE</Text>
                          </View>
                          <View style={styles.ictBreakdownItem}>
                            <Text style={styles.ictBreakdownValue}>{displayStat(player.creativity)}</Text>
                            <Text style={styles.ictBreakdownLabel}>CREATIVITY</Text>
                          </View>
                          <View style={styles.ictBreakdownItem}>
                            <Text style={styles.ictBreakdownValue}>{displayStat(player.threat)}</Text>
                            <Text style={styles.ictBreakdownLabel}>THREAT</Text>
                          </View>
                        </View>
                      </View>

                      <Text style={styles.sectionHeader}>Additional Returns</Text>
                      <View style={styles.statsBox}>
                        {player.element_type !== 'GKP' && (
                          <View style={styles.statRow}>
                            <Text style={styles.statLabel}>Expected Goals / Assists</Text>
                            <Text style={styles.statVal}>{displayStat(player.expected_goals)} / {displayStat(player.expected_assists)}</Text>
                          </View>
                        )}
                        {player.element_type !== 'GKP' && (
                          <View style={styles.statRow}>
                            <Text style={styles.statLabel}>Defensive Contributions</Text>
                            <Text style={styles.statVal}>{displayStat(player.defensive_contribution)}</Text>
                          </View>
                        )}
                        {player.element_type !== 'GKP' && (
                          <>
                            <View style={styles.statRow}>
                              <Text style={styles.statLabel}>Clearances, Blocks &amp; Interceptions</Text>
                              <Text style={styles.statVal}>{displayStat(player.clearances_blocks_interceptions)}</Text>
                            </View>
                            <View style={styles.statRow}>
                              <Text style={styles.statLabel}>Recoveries</Text>
                              <Text style={styles.statVal}>{displayStat(player.recoveries)}</Text>
                            </View>
                            <View style={styles.statRow}>
                              <Text style={styles.statLabel}>Tackles</Text>
                              <Text style={styles.statVal}>{displayStat(player.tackles)}</Text>
                            </View>
                          </>
                        )}
                        <View style={styles.statRow}>
                          <Text style={styles.statLabel}>Bonus Points</Text>
                          <Text style={styles.statVal}>{displayStat(player.bonus)}</Text>
                        </View>
                      </View>

                      <Text style={styles.dataAvailabilityNote}>
                        Official FPL previous-season totals. Defensive contributions are raw actions; historical custom tier points cannot be reconstructed from aggregate data.
                      </Text>
                    </>
                  )}

                  {/* Defensive Contribution Tiers Summary */}
                  {statsMode === 'CURRENT' && (
                    <>
                      <Text style={styles.sectionHeader}>Custom Defensive Contributions (DEFCON)</Text>
                      <View style={styles.cbitBanner}>
                        <Ionicons name="shield-checkmark" size={18} color={colors.accent} />
                        <View style={{ marginLeft: 10, flex: 1 }}>
                          <Text style={styles.cbitBannerTitle}>Custom Tier Points Earned</Text>
                          <Text style={styles.cbitBannerSub}>
                            Accumulated through this league’s custom DEFCON tiers.
                          </Text>
                        </View>
                        <Text style={styles.cbitBannerVal}>
                          +{history.reduce((acc, h) => acc + (h.cbit_points || 0), 0)} PTS
                        </Text>
                      </View>
                    </>
                  )}
                </ScrollView>
              )}

              {/* TAB 2: GAMEWEEK SCORING HISTORY */}
              {activeTab === 'HISTORY' && (
                <ScrollView style={styles.tabScrollView} contentContainerStyle={styles.historyScrollContent} showsVerticalScrollIndicator={false}>
                  {historyLoadError ? (
                    <View style={styles.historyMessageBox}>
                      <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
                      <Text style={styles.historyErrorText}>{historyLoadError}</Text>
                    </View>
                  ) : history.length === 0 ? (
                    <View style={styles.historyMessageBox}>
                      <Ionicons name="stats-chart-outline" size={22} color={colors.textMuted} />
                      <Text style={[styles.emptyText, styles.historyEmptyText]}>No scoring history has been recorded for this season yet.</Text>
                    </View>
                  ) : (
                    <View>
                      <View style={styles.tableHeaderRow}>
                        <Text style={[styles.thCell, { width: 35 }]}>GW</Text>
                        <Text style={[styles.thCell, { flex: 1 }]}>OPPONENT</Text>
                        <Text style={[styles.thCell, { width: 35 }]}>MIN</Text>
                        <Text style={[styles.thCell, { width: 25 }]}>G</Text>
                        <Text style={[styles.thCell, { width: 25 }]}>A</Text>
                        <Text style={[styles.thCell, { width: 30 }]}>DC</Text>
                        <Text style={[styles.thCell, { width: 35, textAlign: 'right' }]}>PTS</Text>
                      </View>

                      {history.map((row) => (
                        <View key={row.gameweek} style={styles.tableBodyRow}>
                          <Text style={[styles.tdCell, { width: 35, fontWeight: '900' }]}>
                            {row.gameweek}
                          </Text>
                          <Text style={[styles.tdCell, { flex: 1 }]}>
                            {row.opponent_display} ({row.score_display})
                          </Text>
                          <Text style={[styles.tdCell, { width: 35 }]}>{row.minutes}'</Text>
                          <Text style={[styles.tdCell, { width: 25 }]}>{row.goals}</Text>
                          <Text style={[styles.tdCell, { width: 25 }]}>{row.assists}</Text>
                          <Text style={[styles.tdCell, { width: 30, color: colors.accent }]}>
                            +{row.cbit_points}
                          </Text>
                          <Text style={[styles.tdCell, styles.ptsCell]}>{row.total_points}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </ScrollView>
              )}

              {/* TAB 3: UPCOMING FIXTURES (FDR) */}
              {activeTab === 'SCHEDULE' && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={styles.sectionHeader}>Next 6 Upcoming Matches</Text>
                  {schedule.length === 0 ? (
                    <Text style={styles.emptyText}>No upcoming fixtures scheduled.</Text>
                  ) : (
                    schedule.map((fix) => {
                      const fdrStyle = FDR_COLORS[fix.fdr] || FDR_COLORS[3];
                      return (
                        <View key={fix.gameweek} style={styles.fixtureCard}>
                          <View style={styles.fixGwBox}>
                            <Text style={styles.fixGwText}>GW {fix.gameweek}</Text>
                          </View>
                          <View style={styles.fixInfoBox}>
                            <Text style={styles.fixOpponentText}>
                              {fix.is_home ? 'vs' : '@'} {fix.opponent_short}
                            </Text>
                            <Text style={styles.fixVenueText}>
                              {fix.is_home ? 'Home Match' : 'Away Match'}
                            </Text>
                          </View>
                          <View style={[styles.fdrBadge, { backgroundColor: fdrStyle.bg }]}>
                            <Text style={[styles.fdrText, { color: fdrStyle.text }]}>
                              FDR {fix.fdr}
                            </Text>
                          </View>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              )}

              {activeTab === 'TRANSFER' && transferListing && (
                <View style={styles.transferTabContent}>
                  <View style={styles.transferListingPanel}>
                    <View style={styles.transferListingHeader}>
                      <View style={styles.transferListingTitleRow}>
                        <Ionicons
                          name="swap-horizontal"
                          size={18}
                          color={transferListing.isListed ? colors.accent : colors.textSecondary}
                        />
                        <View style={styles.transferListingCopy}>
                          <Text style={styles.transferListingTitle}>
                            {transferListing.isListed ? 'TRANSFER LISTED' : 'TRANSFER LIST'}
                          </Text>
                          <Text style={styles.transferListingSubtitle}>
                            {transferListing.isListed
                              ? 'Other managers can currently make an offer for this player.'
                              : 'Advertise this player to the other managers in your league.'}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <Text style={styles.transferListingFieldLabel}>WHAT ARE YOU LOOKING FOR?</Text>
                    <TextInput
                      value={tradeNoteText}
                      onChangeText={setTradeNoteText}
                      editable={!transferListing.saving}
                      maxLength={160}
                      multiline
                      placeholder="Optional note — e.g. looking for a midfielder"
                      placeholderTextColor={colors.textMuted}
                      style={styles.transferListingInput}
                    />
                    <Text style={styles.transferListingCount}>{tradeNoteText.length}/160</Text>

                    <View style={styles.transferListingActions}>
                      {transferListing.isListed && (
                        <TouchableOpacity
                          style={styles.removeListingButton}
                          disabled={transferListing.saving}
                          onPress={() => void transferListing.onRemove()}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.removeListingButtonText}>REMOVE</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[
                          styles.saveListingButton,
                          transferListing.saving && styles.listingButtonDisabled,
                        ]}
                        disabled={transferListing.saving}
                        onPress={() => void transferListing.onSave(tradeNoteText.trim() || null)}
                        activeOpacity={0.8}
                      >
                        {transferListing.saving ? (
                          <ActivityIndicator size="small" color={colors.accentForeground} />
                        ) : (
                          <>
                            <Ionicons name="megaphone" size={14} color={colors.accentForeground} />
                            <Text style={styles.saveListingButtonText}>
                              {transferListing.isListed ? 'UPDATE LISTING' : 'LIST PLAYER'}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}

            </View>
          )}

          {/* BOTTOM FULL-WIDTH CLOSE BUTTON */}
          <TouchableOpacity style={styles.bottomCloseBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.bottomCloseBtnText}>CLOSE</Text>
          </TouchableOpacity> 

        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  overlayMobile: { justifyContent: 'flex-start', alignItems: 'stretch', padding: 0 },
  cardContainer: {
    backgroundColor: colors.surface,
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: 16,
  },
  cardContainerMobile: { width: '100%', maxWidth: undefined, height: '100%', maxHeight: undefined, borderRadius: 0, borderWidth: 0, paddingHorizontal: 10 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  ownershipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  ownershipText: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '900',
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  bottomCloseBtn: {
    backgroundColor: colors.surfacePressed,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  bottomCloseBtnText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },

  heroSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 12,
  },
  avatarWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  playerPhoto: {
    width: '100%',
    height: '100%',
  },
  heroMain: { flex: 1 },
  playerName: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', textTransform: 'uppercase' },
  playerMeta: { color: colors.textMuted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  positionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  positionBadgeText: { color: colors.black, fontSize: 10, fontWeight: '900' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundDeep,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 2,
  },
  tabBtnActive: { backgroundColor: colors.accentFill },
  tabText: { color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  scoringHistoryTabText: { fontSize: 8, letterSpacing: 0.1 },
  tabTextActive: { color: colors.accentForeground },
  seasonBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: 6,
    paddingVertical: 9,
    marginBottom: 16,
  },
  transferListingPanel: {
    padding: 12,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: 8,
  },
  transferListingHeader: { marginBottom: 9 },
  transferTabContent: { flex: 1, justifyContent: 'center' },
  transferListingTitleRow: { flexDirection: 'row', alignItems: 'center' },
  transferListingCopy: { flex: 1, marginLeft: 8 },
  transferListingTitle: { color: colors.textPrimary, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  transferListingSubtitle: { color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 2 },
  transferListingFieldLabel: { color: colors.textSecondary, fontSize: 8, fontWeight: '900', letterSpacing: 0.5, marginBottom: 5 },
  transferListingInput: {
    minHeight: 52,
    maxHeight: 76,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 11,
    textAlignVertical: 'top',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
  },
  transferListingActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 7, marginTop: 9 },
  transferListingCount: { color: colors.textMuted, fontSize: 8, fontWeight: '700', textAlign: 'right', marginTop: 3 },
  removeListingButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: 6,
  },
  removeListingButtonText: { color: colors.danger, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  saveListingButton: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.accentFill,
    borderRadius: 6,
  },
  saveListingButtonText: { color: colors.accentForeground, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  listingButtonDisabled: { opacity: 0.55 },
  seasonBannerText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginLeft: 7,
  },

  loaderBox: { height: 260, justifyContent: 'center', alignItems: 'center' },
  bodyContainer: { minHeight: 280, maxHeight: 380 },
  bodyContainerMobile: { minHeight: 0, maxHeight: undefined, flex: 1 },
  tabScrollView: { flex: 1 },
  historyScrollContent: { flexGrow: 1 },
  historyMessageBox: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  historyEmptyText: { marginTop: 10 },
  historyErrorText: { color: colors.danger, textAlign: 'center', fontSize: 11, lineHeight: 16, fontWeight: '700', marginTop: 10 },
  historyUnavailable: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  historyUnavailableTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 12,
  },
  historyUnavailableCopy: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 8,
  },

  kpiGrid: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  kpiCard: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  kpiValue: { color: colors.accent, fontSize: 16, fontWeight: '900' },
  kpiLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800', marginTop: 2 },

  sectionHeader: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  statsBox: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  statLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  statVal: { color: colors.textPrimary, fontSize: 12, fontWeight: '900' },
  ictHeroCard: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  ictHeroLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  ictHeroValue: { color: colors.accent, fontSize: 26, fontWeight: '900', marginTop: 1 },
  ictBreakdown: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.accentBorder,
    marginTop: 10,
    paddingTop: 10,
  },
  ictBreakdownItem: { flex: 1, alignItems: 'center' },
  ictBreakdownValue: { color: colors.textPrimary, fontSize: 13, fontWeight: '900' },
  ictBreakdownLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800', marginTop: 2 },
  dataAvailabilityNote: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    marginTop: -6,
    marginBottom: 10,
  },

  cbitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    padding: 12,
    borderRadius: 6,
    marginBottom: 12,
  },
  cbitBannerTitle: { color: colors.accent, fontSize: 12, fontWeight: '900' },
  cbitBannerSub: { color: colors.textSecondary, fontSize: 10, marginTop: 1 },
  cbitBannerVal: { color: colors.accent, fontSize: 14, fontWeight: '900' },

  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundDeep,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    marginBottom: 6,
  },
  thCell: { color: colors.textMuted, fontSize: 9, fontWeight: '900', textAlign: 'left' },
  tableBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 4,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tdCell: { color: colors.textPrimary, fontSize: 11, fontWeight: '700' },
  ptsCell: { width: 35, textAlign: 'right', color: colors.accent, fontWeight: '900' },

  emptyText: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 40 },

  fixtureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  fixGwBox: { width: 50 },
  fixGwText: { color: colors.accent, fontSize: 11, fontWeight: '900' },
  fixInfoBox: { flex: 1 },
  fixOpponentText: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  fixVenueText: { color: colors.textMuted, fontSize: 10, fontWeight: '600', marginTop: 1 },
  fdrBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 3 },
  fdrText: { fontSize: 9, fontWeight: '900' },
});
