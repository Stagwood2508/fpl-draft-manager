import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TextInput, TouchableOpacity, ActivityIndicator, Platform, StatusBar, Modal, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../utils/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';

interface PlayerRow {
  id: string;
  fpl_id: number;
  web_name: string;
  element_type: number; // 1 = GK, 2 = DEF, 3 = MID, 4 = FWD
  team_code: string;
  total_points: number;
}

interface SeasonHistory {
  season_name: string;
  total_points: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
}

interface UpcomingFixture {
  id: number;
  event: number;
  opponent_name: string;
  is_home: boolean;
  difficulty: number;
}

const POSITION_MAP: { [key: number]: string } = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

const CLUB_NAME_MAP: { [key: number]: string } = {
  1: 'Arsenal', 2: 'Aston Villa', 3: 'Bournemouth', 4: 'Brentford',
  5: 'Brighton', 6: 'Chelsea', 7: 'Crystal Palace', 8: 'Everton',
  9: 'Fulham', 10: 'Ipswich', 11: 'Leicester', 12: 'Liverpool',
  13: 'Man City', 14: 'Man United', 15: 'Newcastle', 16: 'Nottm Forest',
  17: 'Southampton', 18: 'Tottenham', 19: 'West Ham', 20: 'Wolves'
};

export default function ScoutingPoolScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  
  // 🎯 FIXED: Changed to number[] to match your database int4 player_id type
  const [watchlistIds, setWatchlistIds] = useState<number[]>([]);
  
  const [activeTab, setActiveTab] = useState<'GLOBAL' | 'WATCHLIST'>('GLOBAL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerRow | null>(null);
  const [modalTab, setModalTab] = useState<'HISTORY' | 'FIXTURES'>('HISTORY');
  const [loadingModalData, setLoadingModalData] = useState(false);
  const [historyStats, setHistoryStats] = useState<SeasonHistory[]>([]);
  const [fixturesList, setFixturesList] = useState<UpcomingFixture[]>([]);

  const [profileId, setProfileId] = useState<string | null>(null);
  const [currentLeagueId, setCurrentLeagueId] = useState<string | null>(null);

  useEffect(() => {
    initializeData();
  }, []);

  useEffect(() => {
    if (selectedPlayer) {
      fetchDetailedPlayerData(selectedPlayer.fpl_id);
    }
  }, [selectedPlayer]);

  async function initializeData() {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setProfileId(user.id);
        
        const { data: membership } = await supabase
          .from('league_members')
          .select('league_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();
          
        if (membership) {
          setCurrentLeagueId(membership.league_id);
          const { data: wlData } = await supabase
            .from('watchlist')
            .select('player_id')
            .eq('profile_id', user.id)
            .eq('league_id', membership.league_id);
          
          if (wlData) {
            // 🎯 FIXED: Parsing numeric integer IDs accurately
            setWatchlistIds(wlData.map(item => Number(item.player_id)));
          }
        }
      }

      const { data, error } = await supabase
        .from('players')
        .select('id, fpl_id, web_name, element_type, team_code, total_points')
        .order('total_points', { ascending: false });

      if (error) throw error;
      setPlayers(data || []);
    } catch (err) {
      console.error('Scouting system failure initialization:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDetailedPlayerData(fplId: number) {
    try {
      setLoadingModalData(true);
      setModalTab('HISTORY');
      
      const res = await fetch(`https://fantasy.premierleague.com/api/element-summary/${fplId}/`);
      const json = await res.json();
      
      if (json.history_past) {
        const mappedHistory = json.history_past.map((s: any) => ({
          season_name: s.season_name,
          total_points: s.total_points,
          goals_scored: s.goals_scored || 0,
          assists: s.assists || 0,
          clean_sheets: s.clean_sheets || 0
        }));
        setHistoryStats(mappedHistory.reverse());
      }

      if (json.fixtures) {
        setFixturesList(json.fixtures.slice(0, 5).map((f: any) => {
          const isHome = f.is_home;
          const opponentId = isHome ? f.team_a : f.team_h;
          const opponentName = CLUB_NAME_MAP[opponentId] || `Team ${opponentId}`;
          
          return {
            id: f.id,
            event: f.event,
            opponent_name: opponentName,
            is_home: isHome,
            difficulty: isHome ? f.team_h_difficulty : f.team_a_difficulty
          };
        }));
      }
    } catch (err) {
      console.error('Error fetching deep API parameters metrics:', err);
    } finally {
      setLoadingModalData(false);
    }
  }

  // 🎯 FIXED: Reconfigured function signature to process the numeric fplId
  async function toggleWatchlist(fplId: number) {
    if (!profileId || !currentLeagueId) return;

    const isCurrentlyAdded = watchlistIds.includes(fplId);
    if (isCurrentlyAdded) {
      setWatchlistIds(prev => prev.filter(id => id !== fplId));
    } else {
      setWatchlistIds(prev => [...prev, fplId]);
    }

    try {
      if (isCurrentlyAdded) {
        await supabase
          .from('watchlist')
          .delete()
          .eq('profile_id', profileId)
          .eq('league_id', currentLeagueId)
          .eq('player_id', fplId); // Writes integer safely
      } else {
        const nextOrder = watchlistIds.length + 1;
        await supabase
          .from('watchlist')
          .insert({ 
            profile_id: profileId, 
            league_id: currentLeagueId, 
            player_id: fplId, // Writes integer safely
            preference_order: nextOrder 
          });
      }
    } catch (err) {
      console.error('Watchlist synchronization failure:', err);
      initializeData();
    }
  }

  // 🎯 FIXED: Correct filter lookup alignment
  const baseList = activeTab === 'GLOBAL' ? players : players.filter(p => watchlistIds.includes(p.fpl_id));
  const filteredPlayers = baseList.filter((player) => {
    const matchesSearch = player.web_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          player.team_code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPosition = selectedPosition ? player.element_type === selectedPosition : true;
    return matchesSearch && matchesPosition;
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        
        {/* Navigation Bar Frame */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.push('/')} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back to Table</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Scouting Intelligence</Text>
          <Text style={styles.subtitle}>Target Identification Module</Text>
        </View>

        {/* List Selector Layout Buttons */}
        <View style={styles.viewModeToggleRow}>
          <TouchableOpacity style={[styles.viewModeBtn, activeTab === 'GLOBAL' && styles.viewModeBtnActive]} onPress={() => setActiveTab('GLOBAL')}>
            <Text style={[styles.viewModeBtnText, activeTab === 'GLOBAL' && styles.viewModeBtnTextActive]}>GLOBAL PLAYER LIST</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.viewModeBtn, activeTab === 'WATCHLIST' && styles.viewModeBtnActive, { borderLeftWidth: 0 }]} onPress={() => setActiveTab('WATCHLIST')}>
            <Text style={[styles.viewModeBtnText, activeTab === 'WATCHLIST' && styles.viewModeBtnTextActive]}>MY WATCHLIST ({watchlistIds.length})</Text>
          </TouchableOpacity>
        </View>

        {/* Inputs */}
        <View style={styles.searchBarContainer}>
          <TextInput style={styles.searchTextInput} placeholder="Search player pool records..." placeholderTextColor="#444" value={searchQuery} onChangeText={setSearchQuery} autoCorrect={false} />
        </View>

        {/* Filter Selection Grid Row */}
        <View style={styles.tabContainer}>
          <TouchableOpacity style={[styles.tabBtn, selectedPosition === null && styles.tabBtnActive]} onPress={() => setSelectedPosition(null)}>
            <Text style={[styles.tabBtnText, selectedPosition === null && styles.tabBtnTextActive]}>ALL</Text>
          </TouchableOpacity>
          {[1, 2, 3, 4].map((posId) => (
            <TouchableOpacity key={posId} style={[styles.tabBtn, selectedPosition === posId && styles.tabBtnActive]} onPress={() => setSelectedPosition(posId)}>
              <Text style={[styles.tabBtnText, selectedPosition === posId && styles.tabBtnTextActive]}>{POSITION_MAP[posId]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Table Rows Column Mapping Layout Labels */}
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.thText, styles.colName]}>NAME</Text>
          <Text style={[styles.thText, styles.colClub]}>CLUB</Text>
          <Text style={[styles.thText, styles.colPos]}>ROLE</Text>
          <Text style={[styles.thText, styles.colPts]}>PTS</Text>
          {profileId && <Text style={[styles.thText, styles.colAction]}>WATCHLIST</Text>}
        </View>

        {/* Stream */}
        <FlatList
          data={filteredPlayers}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => {
            const isStarred = watchlistIds.includes(item.fpl_id); // 🎯 FIXED
            return (
              <View style={[styles.tableBodyRow, index % 2 === 1 && styles.rowAlternate]}>
                
                <TouchableOpacity 
                  style={styles.rowTouchArea}
                  onPress={() => setSelectedPlayer(item)}
                >
                  <Text style={[styles.tdText, styles.colName, styles.nameHighlight]} numberOfLines={1}>
                    {item.web_name}
                  </Text>
                  <Text style={[styles.tdText, styles.colClub]} numberOfLines={1}>
                    {item.team_code}
                  </Text>
                  <Text style={[styles.tdText, styles.colPos, (styles[`posText${POSITION_MAP[item.element_type]}` as keyof typeof styles] as any)]}>
                    {POSITION_MAP[item.element_type]}
                  </Text>
                  <Text style={[styles.tdText, styles.colPts, styles.pointsHighlight]}>
                    {item.total_points}
                  </Text>
                </TouchableOpacity>

                <View style={styles.colActionContainer}>
  {profileId ? (
    <TouchableOpacity style={styles.starTouchTarget} onPress={() => toggleWatchlist(item.fpl_id)}>
      <Text style={[styles.starIcon, isStarred && styles.starIconActive]}>
        {isStarred ? '★' : '☆'}
      </Text>
    </TouchableOpacity>
  ) : (
    <View style={styles.starTouchTarget} />
  )}
</View>

              </View>
            );
          }}
          ListEmptyComponent={
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Text style={{ color: '#444', fontSize: 13, fontWeight: '600' }}>
                {activeTab === 'WATCHLIST' ? 'No tracked tactical targets added yet.' : 'No assets match your parameter queries.'}
              </Text>
            </View>
          }
          initialNumToRender={20}
        />

        {/* MODAL PORTAL */}
        <Modal visible={selectedPlayer !== null} transparent={true} animationType="slide" onRequestClose={() => setSelectedPlayer(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.playerCardContainer}>
              {selectedPlayer && (
                <>
                  <View style={[styles.cardAccentBar, (styles[`accentBg${POSITION_MAP[selectedPlayer.element_type]}` as keyof typeof styles] as any)]} />
                  
                  <View style={styles.dossierLayoutHeader}>
                    <View style={styles.dossierMetaBlock}>
                      <View style={styles.badgeRow}>
                        <View style={[styles.roleLabelBadge, (styles[`accentBg${POSITION_MAP[selectedPlayer.element_type]}` as keyof typeof styles] as any)]}>
                          <Text style={styles.roleLabelBadgeText}>{POSITION_MAP[selectedPlayer.element_type]}</Text>
                        </View>
                        <Text style={styles.clubStampText}>{selectedPlayer.team_code.toUpperCase()} // ACTIVE ROSTER</Text>
                      </View>
                      <Text style={styles.dossierPlayerName}>{selectedPlayer.web_name}</Text>
                    </View>
                    <View style={styles.dossierScoreWidget}>
                      <Text style={styles.dossierScoreNumber}>{selectedPlayer.total_points}</Text>
                      <Text style={styles.dossierScoreLabel}>RETURNS</Text>
                    </View>
                  </View>

                  <View style={styles.modalSubTabRow}>
                    <TouchableOpacity style={[styles.modalSubTabBtn, modalTab === 'HISTORY' && styles.modalSubTabBtnActive]} onPress={() => setModalTab('HISTORY')}>
                      <Text style={[styles.modalSubTabBtnText, modalTab === 'HISTORY' && styles.modalSubTabBtnTextActive]}>HISTORICAL CAMPAIGNS</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.modalSubTabBtn, modalTab === 'FIXTURES' && styles.modalSubTabBtnActive]} onPress={() => setModalTab('FIXTURES')}>
                      <Text style={[styles.modalSubTabBtnText, modalTab === 'FIXTURES' && styles.modalSubTabBtnTextActive]}>UPCOMING SCHEDULE</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.dossierMainDisplayArea}>
                    {loadingModalData ? (
                      <View style={{ padding: 30, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="small" color="#00ff87" />
                      </View>
                    ) : modalTab === 'HISTORY' ? (
                      <ScrollView style={{ maxHeight:300 }}>
                        <View style={styles.statsTableHeader}>
                          <Text style={[styles.statsTh, { width: '25%' }]}>SEASON</Text>
                          <Text style={[styles.statsTh, { width: '18%' }]}>GOALS</Text>
                          <Text style={[styles.statsTh, { width: '18%' }]}>ASSISTS</Text>
                          <Text style={[styles.statsTh, { width: '18%' }]}>CLEAN</Text>
                          <Text style={[styles.statsTh, { width: '21%', textAlign: 'right' }]}>TOTAL</Text>
                        </View>
                        {historyStats.length === 0 ? (
                          <Text style={styles.emptyText}>No previous career records registered in database.</Text>
                        ) : (
                          historyStats.map((season, i) => (
                            <View key={i} style={styles.statsTableRow}>
                              <Text style={[styles.statsTd, { width: '25%', color: '#FFF' }]}>{season.season_name}</Text>
                              <Text style={[styles.statsTd, { width: '18%' }]}>{season.goals_scored}</Text>
                              <Text style={[styles.statsTd, { width: '18%' }]}>{season.assists}</Text>
                              <Text style={[styles.statsTd, { width: '18%' }]}>{season.clean_sheets}</Text>
                              <Text style={[styles.statsTd, { width: '21%', textAlign: 'right', color: '#00ff87', fontWeight: '700' }]}>{season.total_points} pts</Text>
                            </View>
                          ))
                        )}
                      </ScrollView>
                    ) : (
                      <ScrollView style={{ maxHeight: 300 }}>
                        <View style={styles.statsTableHeader}>
                          <Text style={[styles.statsTh, { width: '20%' }]}>GW</Text>
                          <Text style={[styles.statsTh, { width: '55%' }]}>OPPONENT MATCHUP</Text>
                          <Text style={[styles.statsTh, { width: '25%', textAlign: 'right' }]}>DIFFICULTY</Text>
                        </View>
                        {fixturesList.length === 0 ? (
                          <Text style={styles.emptyText}>No upcoming structural scheduling maps returned.</Text>
                        ) : (
                          fixturesList.map((fix, i) => (
                            <View key={i} style={styles.statsTableRow}>
                              <Text style={[styles.statsTd, { width: '20%', color: '#666', fontWeight: '700' }]}>GW {fix.event}</Text>
                              <Text style={[styles.statsTd, { width: '55%', color: '#E0E0E0' }]}>
                                {fix.opponent_name} <Text style={{ color: '#444', fontSize: 11 }}>{fix.is_home ? '(H)' : '(A)'}</Text>
                              </Text>
                              <View style={styles.difficultyContainer}>
                                <View style={[styles.fdrBadge, (styles[`fdrColor${fix.difficulty}` as keyof typeof styles] as any)]}>
                                  <Text style={styles.fdrBadgeText}>{fix.difficulty}</Text>
                                </View>
                              </View>
                            </View>
                          ))
                        )}
                      </ScrollView>
                    )}
                  </View>

                  <View style={styles.cardActionGroup}>
                    {profileId && (
                      <TouchableOpacity 
                        style={[styles.dossierWatchlistBtn, watchlistIds.includes(selectedPlayer.fpl_id) && styles.dossierWatchlistBtnActive]} 
                        onPress={() => toggleWatchlist(selectedPlayer.fpl_id)} // 🎯 FIXED
                      >
                        <Text style={[styles.dossierWatchlistBtnText, watchlistIds.includes(selectedPlayer.fpl_id) && styles.dossierWatchlistBtnTextActive]}>
                          {watchlistIds.includes(selectedPlayer.fpl_id) ? '★ REMOVE SHORTLIST' : '☆ ADD TO WATCHLIST'}
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.dossierCloseBtn} onPress={() => setSelectedPlayer(null)}>
                      <Text style={styles.dossierCloseBtnText}>DISMISS REPORT</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0A0A0A', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { paddingHorizontal: 20, marginTop: 12, marginBottom: 8 },
  backBtn: { alignSelf: 'flex-start', marginBottom: 4 },
  backBtnText: { color: '#00ff87', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  title: { fontSize: 20, fontWeight: '800', color: '#F5F5F5' },
  subtitle: { fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700', marginTop: 2 },
  viewModeToggleRow: { flexDirection: 'row', paddingHorizontal: 20, marginTop: 12, marginBottom: 8 },
  viewModeBtn: { flex: 1, backgroundColor: 'transparent', height: 38, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#141414' },
  viewModeBtnActive: { backgroundColor: '#111', borderColor: '#1F1F1F' },
  viewModeBtnText: { color: '#444', fontSize: 11, fontWeight: '700' },
  viewModeBtnTextActive: { color: '#00ff87' },
  searchBarContainer: { paddingHorizontal: 20, marginVertical: 4 },
  searchTextInput: { backgroundColor: '#0D0D0D', height: 42, borderRadius: 4, borderWidth: 1, borderColor: '#141414', paddingHorizontal: 14, color: '#F5F5F5', fontSize: 13 },
  tabContainer: { flexDirection: 'row', paddingHorizontal: 20, gap: 4, marginVertical: 10 },
  tabBtn: { flex: 1, backgroundColor: '#0D0D0D', height: 30, borderRadius: 3, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#141414' },
  tabBtnActive: { backgroundColor: '#111', borderColor: '#222' },
  tabBtnText: { color: '#444', fontSize: 10, fontWeight: '700' },
  tabBtnTextActive: { color: '#F5F5F5' },
  
  tableHeaderRow: { flexDirection: 'row', backgroundColor: '#111', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1A1A1A', alignItems: 'center' },
  tableBodyRow: { flexDirection: 'row', paddingHorizontal: 16, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#0F0F0F' },
  rowAlternate: { backgroundColor: '#080808' },
  
  rowTouchArea: { flexDirection: 'row', flex: 80, paddingVertical: 14, alignItems: 'center' },
  colActionContainer: { flex: 20, alignItems: 'center', justifyContent: 'center' },

  colName: { flex: 40, textAlign: 'left' },
  colClub: { flex: 20, textAlign: 'left', paddingLeft: 4 },
  colPos: { flex: 10, textAlign: 'center' },
  colPts: { flex: 10, textAlign: 'right', paddingRight: 4 },
  colAction: { flex: 20, textAlign: 'center' },
  
  thText: { color: '#333', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  tdText: { color: '#777', fontSize: 13 },
  starTouchTarget: { paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  nameHighlight: { color: '#E0E0E0', fontWeight: '500' },
  pointsHighlight: { color: '#00ff87', fontWeight: '700' },
  starIcon: { fontSize: 24, color: '#1A1A1A', textAlign: 'center'},
  starIconActive: { color: '#00ff87' },
  
  posTextGK: { color: '#D4AF37', fontWeight: '600', textAlign: 'center' },
  posTextDEF: { color: '#4A90E2', fontWeight: '600', textAlign: 'center' },
  posTextMID: { color: '#7ED321', fontWeight: '600', textAlign: 'center' },
  posTextFWD: { color: '#D0021B', fontWeight: '600', textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  playerCardContainer: { backgroundColor: '#0D0D0D', borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 24, paddingBottom: Platform.OS === 'ios' ? 42 : 24, borderWidth: 1, borderColor: '#191919', minHeight: '75%' },
  cardAccentBar: { height: 3, width: '100%', position: 'absolute', top: 0, left: 0, right: 0 },
  accentBgGK: { backgroundColor: '#D4AF37' },
  accentBgDEF: { backgroundColor: '#4A90E2' },
  accentBgMID: { backgroundColor: '#7ED321' },
  accentBgFWD: { backgroundColor: '#D0021B' },
  
  dossierLayoutHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 10 },
  dossierMetaBlock: { flex: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  roleLabelBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 2 },
  roleLabelBadgeText: { color: '#0A0A0A', fontSize: 10, fontWeight: '900' },
  clubStampText: { color: '#444', fontSize: 10, fontWeight: '700' },
  dossierPlayerName: { color: '#FFF', fontSize: 22, fontWeight: '800' },
  
  dossierScoreWidget: { alignItems: 'flex-end', backgroundColor: '#111', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: '#1F1F1F' },
  dossierScoreNumber: { color: '#00ff87', fontSize: 22, fontWeight: '900' },
  dossierScoreLabel: { color: '#333', fontSize: 8, fontWeight: '800', marginTop: 2 },

  modalSubTabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#141414', marginTop: 20, marginBottom: 12 },
  modalSubTabBtn: { paddingBottom: 10, marginRight: 20, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  modalSubTabBtnActive: { borderBottomColor: '#00ff87' },
  modalSubTabBtnText: { color: '#333', fontSize: 11, fontWeight: '800' },
  modalSubTabBtnTextActive: { color: '#00ff87' },

  dossierMainDisplayArea: { backgroundColor: '#111', borderRadius: 4, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: '#141414', flex: 1, minHeight: 260 },
  
  statsTableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1A1A1A', paddingBottom: 6, marginBottom: 8 },
  statsTh: { color: '#333', fontSize: 9, fontWeight: '800' },
  statsTableRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#151515', alignItems: 'center' },
  statsTd: { color: '#888', fontSize: 12, fontWeight: '500' },
  emptyText: { color: '#444', fontSize: 12, textAlign: 'center', marginVertical: 20, fontWeight: '600' },

  difficultyContainer: { width: '25%', alignItems: 'flex-end' },
  fdrBadge: { width: 22, height: 22, borderRadius: 3, justifyContent: 'center', alignItems: 'center' },
  fdrBadgeText: { color: '#0A0A0A', fontSize: 11, fontWeight: '900' },

  fdrColor1: { backgroundColor: '#377dff' },
  fdrColor2: { backgroundColor: '#00ff87' },
  fdrColor3: { backgroundColor: '#ebebeb' },
  fdrColor4: { backgroundColor: '#ff9c00' },
  fdrColor5: { backgroundColor: '#e63946' },

  cardActionGroup: { flexDirection: 'row', gap: 10 },
  dossierWatchlistBtn: { flex: 5, backgroundColor: '#00ff87', height: 44, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  dossierWatchlistBtnActive: { backgroundColor: '#111', borderWidth: 1, borderColor: '#D0021B' },
  dossierWatchlistBtnText: { color: '#0A0A0A', fontSize: 12, fontWeight: '800' },
  dossierWatchlistBtnTextActive: { color: '#D0021B' },
  dossierCloseBtn: { flex: 4, backgroundColor: 'transparent', height: 44, borderRadius: 4, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#1C1C1C' },
  dossierCloseBtnText: { color: '#444', fontSize: 12, fontWeight: '700' }
});