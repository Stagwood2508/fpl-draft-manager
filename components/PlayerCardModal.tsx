import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/utils/supabase';
import KitIcon from '@/components/KitIcon';

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
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  yellow_cards: number;
  red_cards: number;
  form?: string;
  points_per_game?: string;
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
  currentGameweek: number;
  onClose: () => void;
}

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
  currentGameweek,
  onClose,
}: PlayerCardModalProps) {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'HISTORY' | 'SCHEDULE'>('OVERVIEW');
  const [loading, setLoading] = useState<boolean>(true);
  const [imageError, setImageError] = useState<boolean>(false);

  const [player, setPlayer] = useState<PlayerDetails | null>(null);
  const [history, setHistory] = useState<GameweekStat[]>([]);
  const [schedule, setSchedule] = useState<UpcomingFixture[]>([]);

  useEffect(() => {
    if (visible && playerId) {
      setImageError(false);
      loadPlayerData();
    } else {
      setActiveTab('OVERVIEW');
      setPlayer(null);
      setHistory([]);
      setSchedule([]);
      setImageError(false);
    }
  }, [visible, playerId]);

  const loadPlayerData = async () => {
    if (!playerId) return;
    try {
      setLoading(true);

      // 1. Fetch Player Base Info & Ownership Status in League
      const { data: playerData, error: pErr } = await supabase
        .from('players')
        .select('*')
        .eq('id', playerId)
        .single();

      if (pErr) throw pErr;

      let ownerDisplayName: string | null = null;

      if (leagueId) {
        const { data: rosterData } = await supabase
          .from('rosters')
          .select('user_id')
          .eq('league_id', leagueId)
          .eq('player_id', Number(playerId))
          .maybeSingle();

        if (rosterData?.user_id) {
          const { data: memberData } = await supabase
            .from('league_members')
            .select('team_name') // Updated from display_name
            .eq('league_id', leagueId)
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

      setPlayer({
        ...playerData,
        team_short_name: playerData.team_short_name || (playerData.team_name ? playerData.team_name.slice(0, 3).toUpperCase() : 'PL'),
        owner_name: ownerDisplayName,
      });

      // 2. Fetch Completed Gameweek Stats History
      const { data: statsData } = await supabase
        .from('player_gameweek_stats')
        .select(`
          gameweek,
          minutes,
          goals,
          assists,
          clean_sheets,
          cbit_points,
          total_points,
          fixtures (
            home_team_short,
            away_team_short,
            home_score,
            away_score
          )
        `)
        .eq('player_id', playerId)
        .lte('gameweek', currentGameweek)
        .order('gameweek', { ascending: false });

      if (statsData) {
        const formattedHistory: GameweekStat[] = statsData.map((row: any) => {
          const fix = row.fixtures;
          const isHome = fix?.home_team_short === playerData.team_name?.slice(0, 3).toUpperCase();
          const oppShort = isHome ? fix?.away_team_short || 'OPP' : fix?.home_team_short || 'OPP';
          const score = fix ? `${fix.home_score ?? 0}-${fix.away_score ?? 0}` : 'v';

          return {
            gameweek: row.gameweek,
            minutes: row.minutes || 0,
            goals: row.goals || 0,
            assists: row.assists || 0,
            clean_sheets: row.clean_sheets || 0,
            cbit_points: row.cbit_points || 0,
            total_points: row.total_points || 0,
            opponent_short: oppShort,
            is_home: isHome,
            score_display: score,
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
            fdr: isHome ? fix.home_fdr || 3 : fix.away_fdr || 3,
          };
        });
        setSchedule(formattedSchedule);
      }
    } catch (err: any) {
      Alert.alert('Error Loading Player Card', err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  const photoCode = player?.photo_code || player?.id;

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.cardContainer}>
          
          {/* TOP BAR / CLOSE BUTTON */}
          <View style={styles.topBar}>
            <View style={styles.ownershipBadge}>
              <Ionicons
                name={player?.owner_name ? 'shield' : 'people'}
                size={12}
                color={player?.owner_name ? '#FFC107' : '#00FF87'}
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
      {(player.photo_code || player.code || player.id) && !imageError ? (
        <Image
          source={{
            uri: `https://resources.premierleague.com/premierleague/photos/players/250x250/p${player.photo_code || player.code || player.id}.png`,
          }}
          style={styles.playerPhoto}
          resizeMode="contain"
          onError={() => setImageError(true)}
        />
      ) : (
        <KitIcon teamId={player.team_id || 0} size={42} />
      )}
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
          <View style={styles.tabBar}>
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
              <Text style={[styles.tabText, activeTab === 'HISTORY' && styles.tabTextActive]}>LOG</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'SCHEDULE' && styles.tabBtnActive]}
              onPress={() => setActiveTab('SCHEDULE')}
            >
              <Text style={[styles.tabText, activeTab === 'SCHEDULE' && styles.tabTextActive]}>FIXTURES</Text>
            </TouchableOpacity>
          </View>

          {/* CONTENT BODY */}
          {loading ? (
            <View style={styles.loaderBox}>
              <ActivityIndicator size="large" color="#00FF87" />
            </View>
          ) : (
            <View style={styles.bodyContainer}>
              
              {/* TAB 1: OVERVIEW & STATS */}
              {activeTab === 'OVERVIEW' && player && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* KPI Summary Grid */}
                  <View style={styles.kpiGrid}>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiValue}>{player.total_points}</Text>
                      <Text style={styles.kpiLabel}>TOTAL PTS</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiValue}>{player.points_per_game || '0.0'}</Text>
                      <Text style={styles.kpiLabel}>AVG / MATCH</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiValue}>{player.form || '0.0'}</Text>
                      <Text style={styles.kpiLabel}>FORM</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiValue}>{player.minutes}'</Text>
                      <Text style={styles.kpiLabel}>MINUTES</Text>
                    </View>
                  </View>

                  {/* Attacking & Match Action Summary */}
                  <Text style={styles.sectionHeader}>Matchday Return Metrics</Text>
                  <View style={styles.statsBox}>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Goals Scored</Text>
                      <Text style={styles.statVal}>{player.goals_scored}</Text>
                    </View>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Assists</Text>
                      <Text style={styles.statVal}>{player.assists}</Text>
                    </View>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Clean Sheets</Text>
                      <Text style={styles.statVal}>{player.clean_sheets}</Text>
                    </View>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Yellow / Red Cards</Text>
                      <Text style={styles.statVal}>
                        {player.yellow_cards} / {player.red_cards}
                      </Text>
                    </View>
                  </View>

                  {/* Defensive Contribution Tiers Summary */}
                  <Text style={styles.sectionHeader}>Tactical Defensive Contributions (CBIT/CBIRT)</Text>
                  <View style={styles.cbitBanner}>
                    <Ionicons name="shield-checkmark" size={18} color="#00FF87" />
                    <View style={{ marginLeft: 10, flex: 1 }}>
                      <Text style={styles.cbitBannerTitle}>Custom Tier Points Earned</Text>
                      <Text style={styles.cbitBannerSub}>
                        Accumulated via successful CBIT/CBIRT action thresholds.
                      </Text>
                    </View>
                    <Text style={styles.cbitBannerVal}>
                      +{history.reduce((acc, h) => acc + (h.cbit_points || 0), 0)} PTS
                    </Text>
                  </View>
                </ScrollView>
              )}

              {/* TAB 2: GAMEWEEK HISTORY LOG */}
              {activeTab === 'HISTORY' && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {history.length === 0 ? (
                    <Text style={styles.emptyText}>No fixture stats recorded for this season yet.</Text>
                  ) : (
                    <View>
                      <View style={styles.tableHeaderRow}>
                        <Text style={[styles.thCell, { width: 35 }]}>GW</Text>
                        <Text style={[styles.thCell, { flex: 1 }]}>OPPONENT</Text>
                        <Text style={[styles.thCell, { width: 35 }]}>MIN</Text>
                        <Text style={[styles.thCell, { width: 25 }]}>G</Text>
                        <Text style={[styles.thCell, { width: 25 }]}>A</Text>
                        <Text style={[styles.thCell, { width: 30 }]}>CBIT</Text>
                        <Text style={[styles.thCell, { width: 35, textAlign: 'right' }]}>PTS</Text>
                      </View>

                      {history.map((row) => (
                        <View key={row.gameweek} style={styles.tableBodyRow}>
                          <Text style={[styles.tdCell, { width: 35, fontWeight: '900' }]}>
                            {row.gameweek}
                          </Text>
                          <Text style={[styles.tdCell, { flex: 1 }]}>
                            {row.is_home ? 'vs ' : '@ '}
                            {row.opponent_short} ({row.score_display})
                          </Text>
                          <Text style={[styles.tdCell, { width: 35 }]}>{row.minutes}'</Text>
                          <Text style={[styles.tdCell, { width: 25 }]}>{row.goals}</Text>
                          <Text style={[styles.tdCell, { width: 25 }]}>{row.assists}</Text>
                          <Text style={[styles.tdCell, { width: 30, color: '#00FF87' }]}>
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

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  cardContainer: {
    backgroundColor: '#121212',
    width: '100%',
    maxHeight: '90%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    padding: 16,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  ownershipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  ownershipText: {
    color: '#AAA',
    fontSize: 9,
    fontWeight: '900',
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  bottomCloseBtn: {
    backgroundColor: '#1E1E22',
    borderWidth: 1,
    borderColor: '#33333C',
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  bottomCloseBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },

  heroSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    paddingBottom: 12,
  },
  avatarWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#00FF87',
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
  playerName: { color: '#FFF', fontSize: 18, fontWeight: '900', textTransform: 'uppercase' },
  playerMeta: { color: '#666', fontSize: 11, fontWeight: '700', marginTop: 2 },
  positionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  positionBadgeText: { color: '#000', fontSize: 10, fontWeight: '900' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#000',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#222',
    padding: 3,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 2,
  },
  tabBtnActive: { backgroundColor: '#00FF87' },
  tabText: { color: '#666', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  tabTextActive: { color: '#000' },

  loaderBox: { height: 260, justifyContent: 'center', alignItems: 'center' },
  bodyContainer: { minHeight: 280, maxHeight: 380 },

  kpiGrid: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  kpiCard: {
    flex: 1,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  kpiValue: { color: '#00FF87', fontSize: 16, fontWeight: '900' },
  kpiLabel: { color: '#555', fontSize: 8, fontWeight: '800', marginTop: 2 },

  sectionHeader: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  statsBox: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#222226',
  },
  statLabel: { color: '#AAA', fontSize: 12, fontWeight: '700' },
  statVal: { color: '#FFF', fontSize: 12, fontWeight: '900' },

  cbitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00FF8710',
    borderWidth: 1,
    borderColor: '#00FF8744',
    padding: 12,
    borderRadius: 6,
    marginBottom: 12,
  },
  cbitBannerTitle: { color: '#00FF87', fontSize: 12, fontWeight: '900' },
  cbitBannerSub: { color: '#888', fontSize: 10, marginTop: 1 },
  cbitBannerVal: { color: '#00FF87', fontSize: 14, fontWeight: '900' },

  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#000',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 4,
    marginBottom: 6,
  },
  thCell: { color: '#666', fontSize: 9, fontWeight: '900', textAlign: 'left' },
  tableBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 4,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#222',
  },
  tdCell: { color: '#DDD', fontSize: 11, fontWeight: '700' },
  ptsCell: { width: 35, textAlign: 'right', color: '#00FF87', fontWeight: '900' },

  emptyText: { color: '#555', fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 40 },

  fixtureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#222',
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  fixGwBox: { width: 50 },
  fixGwText: { color: '#00FF87', fontSize: 11, fontWeight: '900' },
  fixInfoBox: { flex: 1 },
  fixOpponentText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  fixVenueText: { color: '#555', fontSize: 10, fontWeight: '600', marginTop: 1 },
  fdrBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 3 },
  fdrText: { fontSize: 9, fontWeight: '900' },
});