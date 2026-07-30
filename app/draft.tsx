import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, FlatList, TextInput, TouchableOpacity, ActivityIndicator, Alert, Modal, ScrollView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@utils/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveManagerForPick, getPicksUntilMyTurn, PositionCounts } from 'utils/draftEngine';

interface Player {
  id: string;          // uuid
  fpl_id: number;      // integer
  first_name: string;  // text
  second_name: string; // text
  web_name: string;    // text
  team_code: string;   // text (Club Name)
  element_type: number; // integer (1 = GKP, 2 = DEF, 3 = MID, 4 = FWD)
  total_points: number; // integer
}

interface PastSeason {
  season_name: string;
  total_points: number;
  goals_scored: number;
  assists: number;
  minutes: number;
  clean_sheets: number;
  goals_conceded: number;
}

interface UpcomingFixture {
  id: number;
  event: number;
  opponent_name: string;
  is_home: boolean;
  difficulty: number;
}

const POSITION_LABELS: { [key: number]: string } = {
  1: 'Goalkeeper',
  2: 'Defender',
  3: 'Midfielder',
  4: 'Forward'
};

const POSITION_SHORTS: { [key: number]: string } = {
  1: 'GKP',
  2: 'DEF',
  3: 'MID',
  4: 'FWD'
};

const POSITION_MAP_STR: { [key: number]: 'GK' | 'DEF' | 'MID' | 'FWD' } = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD'
};

const CLUB_NAME_MAP: { [key: number]: string } = {
  1: 'Arsenal', 2: 'Aston Villa', 3: 'Bournemouth', 4: 'Brentford',
  5: 'Brighton', 6: 'Chelsea', 7: 'Crystal Palace', 8: 'Everton',
  9: 'Fulham', 10: 'Ipswich', 11: 'Leicester', 12: 'Liverpool',
  13: 'Man City', 14: 'Man United', 15: 'Newcastle', 16: 'Nottm Forest',
  17: 'Southampton', 18: 'Tottenham', 19: 'West Ham', 20: 'Wolves'
};

const TURN_DURATION = 90;

export default function DraftRoomScreen() {
  const [commissionerId, setCommissionerId] = useState<string | null>(null);
  const [turnStartedAt, setTurnStartedAt] = useState<string | null>(null);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  const [sortByPoints, setSortByPoints] = useState(true);
  
  // League Roster Rule Type
  const [rosterType, setRosterType] = useState<'STRICT' | 'FLEXIBLE'>('STRICT');

  const [selectedModalPlayer, setSelectedModalPlayer] = useState<Player | null>(null);
  const [modalTab, setModalTab] = useState<'HISTORY' | 'FIXTURES'>('HISTORY');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [pastHistory, setPastHistory] = useState<PastSeason[]>([]);
  const [fixturesList, setFixturesList] = useState<UpcomingFixture[]>([]);
  
  const [watchlistPlayerIds, setWatchlistPlayerIds] = useState<Set<number>>(new Set());
  const [showWatchlistDrawer, setShowWatchlistDrawer] = useState(false);
  
  const [selectedClub, setSelectedClub] = useState<string | null>(null);
  const [buttonDockPosition, setButtonDockPosition] = useState<'bottom' | 'top'>('bottom');
  
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [draftedPlayerIds, setDraftedPlayerIds] = useState<Set<string>>(new Set());
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [managers, setManagers] = useState<any[]>([]);
  const [mySquadCounts, setMySquadCounts] = useState<PositionCounts>({ GK: 0, DEF: 0, MID: 0, FWD: 0 });
  const [overallPickIndex, setOverallPickIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TURN_DURATION);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const activeManager = managers.length > 0 ? getActiveManagerForPick(managers, overallPickIndex) : null;
  const isMyTurn = activeManager && currentUserId === activeManager.profile_id;
  const currentRound = Math.floor(overallPickIndex / (managers.length || 1)) + 1;
  const picksUntilTurn = managers.length > 0 && currentUserId 
    ? getPicksUntilMyTurn(managers, overallPickIndex, currentUserId)
    : -1;

  // Position Cap Validator respecting STRICT vs FLEXIBLE modes
  const isPositionLocked = (counts: PositionCounts, elementType: number) => {
    if (elementType === 1) return counts.GK >= 2;
    if (rosterType === 'FLEXIBLE') {
      if (elementType === 2) return counts.DEF >= 6;
      if (elementType === 3) return counts.MID >= 6;
      if (elementType === 4) return counts.FWD >= 4;
    } else {
      if (elementType === 2) return counts.DEF >= 5;
      if (elementType === 3) return counts.MID >= 5;
      if (elementType === 4) return counts.FWD >= 3;
    }
    return false;
  };

  useEffect(() => {
    if (!selectedModalPlayer) {
      setPastHistory([]);
      setFixturesList([]);
      return;
    }

    async function fetchDetailedPlayerData() {
      try {
        setLoadingHistory(true);
        setModalTab('HISTORY');
        
        const res = await fetch(`https://fantasy.premierleague.com/api/element-summary/${selectedModalPlayer?.fpl_id}/`);
        const json = await res.json();
        
        if (json.history_past) {
          const mappedHistory = json.history_past.map((s: any) => ({
            season_name: s.season_name,
            total_points: s.total_points,
            goals_scored: s.goals_scored || 0,
            assists: s.assists || 0,
            clean_sheets: s.clean_sheets || 0
          }));
          setPastHistory(mappedHistory.reverse());
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
        console.error("Could not fetch player details inside draft context:", err);
      } finally {
        setLoadingHistory(false);
      }
    }

    fetchDetailedPlayerData();
  }, [selectedModalPlayer]);

  useEffect(() => {
    loadDraftContext();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    if (loading || managers.length === 0) return;
    
    if (timerRef.current) clearInterval(timerRef.current);

    const recalculateRemainingSeconds = () => {
      const startTime = turnStartedAt ? new Date(turnStartedAt).getTime() : Date.now();
      const currentTime = Date.now();
      const elapsedSeconds = Math.floor((currentTime - startTime) / 1000);
      const remaining = Math.max(0, TURN_DURATION - elapsedSeconds);
      
      setTimeLeft(remaining);

      if (remaining === 0) {
        clearInterval(timerRef.current!);
        
        const liveActiveManager = getActiveManagerForPick(managers, overallPickIndex);
        if (liveActiveManager) {
          if (currentUserId === liveActiveManager.profile_id) {
            triggerAutoPick();
          } else {
            triggerMockManagerAutoPick(liveActiveManager.profile_id);
          }
        }
      }
    };

    recalculateRemainingSeconds();
    timerRef.current = setInterval(recalculateRemainingSeconds, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [overallPickIndex, loading, managers, turnStartedAt, currentUserId]);

  async function loadDraftContext() {
    try {
      setLoading(true);
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Unauthorized session.");
      setCurrentUserId(user.id);

      const { data: memberships, error: mError } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (mError || !memberships) {
        Alert.alert('No League Link', 'Please join or create a league before drafting.');
        router.replace('/league-setup');
        return;
      }
      const leagueId = memberships.league_id;
      setActiveLeagueId(leagueId);

      const [picksRes, mgrsRes, savedWatchlist, playerPool, leagueDetails] = await Promise.all([
        supabase.from('draft_picks').select('player_id, user_id').eq('league_id', leagueId),
        supabase.from('league_members').select('user_id, draft_position').eq('league_id', leagueId),
        supabase.from('watchlist').select('player_id').eq('profile_id', user.id).eq('league_id', leagueId),
        supabase.from('players').select('id, fpl_id, first_name, second_name, web_name, team_code, element_type, total_points').order('total_points', { ascending: false }),
        supabase.from('leagues').select('owner_id, turn_started_at, roster_type').eq('id', leagueId).maybeSingle()
      ]);

      if (leagueDetails.data) {
        setCommissionerId(leagueDetails.data.owner_id);
        setTurnStartedAt(leagueDetails.data.turn_started_at);
        if (leagueDetails.data.roster_type) {
          setRosterType(leagueDetails.data.roster_type as 'STRICT' | 'FLEXIBLE');
        }
      }

      if (picksRes.error) throw picksRes.error;
      if (mgrsRes.error) throw mgrsRes.error;
      if (savedWatchlist.error) throw savedWatchlist.error;
      if (playerPool.error) throw playerPool.error;

      const takenIds = new Set<string>((picksRes.data || []).map(p => String(p.player_id)));
      setDraftedPlayerIds(takenIds);

      const myPicks = (picksRes.data || []).filter(p => p.user_id === user.id);
      const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
      myPicks.forEach(p => {
        const match = playerPool.data?.find(pl => pl.id === p.player_id);
        if (match) {
          const role = POSITION_MAP_STR[match.element_type];
          counts[role]++;
        }
      });
      setMySquadCounts(counts);

      setOverallPickIndex((picksRes.data || []).length);
      setManagers(mgrsRes.data?.map((m, i) => ({ profile_id: m.user_id, draft_position: m.draft_position ?? i })) || []);
      setWatchlistPlayerIds(new Set((savedWatchlist.data || []).map(w => Number(w.player_id))));
      setAllPlayers(playerPool.data || []);

    } catch (err: any) {
      Alert.alert('Draft Initialisation Error', err.message || 'Could not map player list.');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleWatchlist(fplId: number) {
    if (!activeLeagueId || !currentUserId) return;
    const isWatchlisted = watchlistPlayerIds.has(fplId);

    try {
      if (isWatchlisted) {
        const { error } = await supabase
          .from('watchlist')
          .delete()
          .eq('profile_id', currentUserId)
          .eq('league_id', activeLeagueId)
          .eq('player_id', fplId);

        if (error) throw error;
        setWatchlistPlayerIds(prev => { const next = new Set(prev); next.delete(fplId); return next; });
      } else {
        const nextOrder = watchlistPlayerIds.size + 1;
        const { error } = await supabase
          .from('watchlist')
          .insert({ profile_id: currentUserId, league_id: activeLeagueId, player_id: fplId, preference_order: nextOrder });

        if (error) throw error;
        setWatchlistPlayerIds(prev => { const next = new Set(prev); next.add(fplId); return next; });
      }
    } catch (err: any) {
      console.error("Watchlist transaction failed:", err);
    }
  }

  async function handleDraftPlayer(player: Player) {
    if (!activeLeagueId || !currentUserId) return;

    if (!isMyTurn) {
      Alert.alert('Hold On', "It is not your turn to pick yet. Keep planning your strategy!");
      return;
    }

    const role = POSITION_MAP_STR[player.element_type];
    if (isPositionLocked(mySquadCounts, player.element_type)) {
      Alert.alert('Roster Cap Reached', `Your squad already has the maximum allowed number of ${POSITION_LABELS[player.element_type]} options.`);
      return;
    }

    Alert.alert(
      'Confirm Selection',
      `Are you sure you want to draft ${player.web_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Draft Player',
          onPress: async () => {
            try {
              const liveIsoString = new Date().toISOString();
              setDraftedPlayerIds(prev => { const next = new Set(prev); next.add(player.id); return next; });
              setMySquadCounts(prev => ({ ...prev, [role]: prev[role] + 1 }));
              setOverallPickIndex(prev => prev + 1);
              setTurnStartedAt(liveIsoString);

              const { error } = await supabase
                .from('draft_picks')
                .insert({
                  league_id: activeLeagueId,
                  user_id: currentUserId,
                  player_id: player.id,
                  round_number: currentRound,
                  pick_number: overallPickIndex
                });

              if (error) {
                if (error.code === '23505') throw new Error("This player was already taken!");
                throw error;
              }

              await supabase.from('leagues').update({ turn_started_at: liveIsoString }).eq('id', activeLeagueId);

              if (watchlistPlayerIds.has(player.fpl_id)) {
                await supabase
                  .from('watchlist')
                  .delete()
                  .eq('profile_id', currentUserId)
                  .eq('league_id', activeLeagueId)
                  .eq('player_id', player.fpl_id);
                
                setWatchlistPlayerIds(prev => { const next = new Set(prev); next.delete(player.fpl_id); return next; });
              }

              setSelectedModalPlayer(null);
              Alert.alert('Signed! 📝', `${player.web_name} has joined your squad.`);

            } catch (err: any) {
              Alert.alert('Draft Selection Failure', err.message || 'Database rejected selection.');
              loadDraftContext();
            }
          }
        }
      ]
    );
  }

  function triggerAutoPick() {
    const available = allPlayers.filter(p => !draftedPlayerIds.has(p.id));
    
    const validWatchlistTarget = available.find(
      p => watchlistPlayerIds.has(p.fpl_id) && !isPositionLocked(mySquadCounts, p.element_type)
    );
    const backupTarget = available.find(
      p => !isPositionLocked(mySquadCounts, p.element_type)
    );

    const ultimateSelection = validWatchlistTarget || backupTarget;
    if (ultimateSelection) {
      const liveIsoString = new Date().toISOString();
      const role = POSITION_MAP_STR[ultimateSelection.element_type];
      setDraftedPlayerIds(prev => { const next = new Set(prev); next.add(ultimateSelection.id); return next; });
      setMySquadCounts(prev => ({ ...prev, [role]: prev[role] + 1 }));
      setOverallPickIndex(prev => prev + 1);
      setTurnStartedAt(liveIsoString);

      supabase.from('draft_picks').insert({
        league_id: activeLeagueId,
        user_id: currentUserId,
        player_id: ultimateSelection.id,
        round_number: currentRound,
        pick_number: overallPickIndex
      }).then(({ error }) => {
        if (!error) {
          supabase.from('leagues').update({ turn_started_at: liveIsoString }).eq('id', activeLeagueId).then();
        } else {
          loadDraftContext();
        }
      });
    }
  }

  function triggerMockManagerAutoPick(mockManagerId: string) {
    const available = allPlayers.filter(p => !draftedPlayerIds.has(p.id));
    const topScorerLeft = available[0];

    if (topScorerLeft) {
      const liveIsoString = new Date().toISOString();
      setDraftedPlayerIds(prev => { const next = new Set(prev); next.add(topScorerLeft.id); return next; });
      setOverallPickIndex(prev => prev + 1);
      setTurnStartedAt(liveIsoString);

      supabase.from('draft_picks').insert({
        league_id: activeLeagueId,
        user_id: mockManagerId,
        player_id: topScorerLeft.id,
        round_number: currentRound,
        pick_number: overallPickIndex
      }).then(({ error }) => {
        if (error) {
          console.error("Mock transaction rollback:", error.message);
          loadDraftContext();
        } else {
          supabase.from('leagues').update({ turn_started_at: liveIsoString }).eq('id', activeLeagueId).then();
        }
      });
    } else {
      setOverallPickIndex(prev => prev + 1);
      setTurnStartedAt(new Date().toISOString());
    }
  }

  const processedPlayerPool = allPlayers
    .filter(player => {
      if (draftedPlayerIds.has(player.id)) return false;
      if (selectedPosition && player.element_type !== selectedPosition) return false;
      if (selectedClub && player.team_code !== selectedClub) return false;
      
      if (searchQuery.trim() !== '') {
        const fullSearchString = `${player.first_name} ${player.second_name} ${player.web_name} ${player.team_code}`.toLowerCase();
        return fullSearchString.includes(searchQuery.toLowerCase());
      }
      return true;
    })
    .sort((a, b) => {
      if (sortByPoints) {
        return b.total_points - a.total_points || a.web_name.localeCompare(b.web_name);
      }
      return a.web_name.localeCompare(b.web_name);
    });

  const watchlistedPlayers = allPlayers
    .filter(player => watchlistPlayerIds.has(player.fpl_id) && !draftedPlayerIds.has(player.id))
    .sort((a, b) => b.total_points - a.total_points);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color="#00ff87" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        
        {/* TOP NAVIGATION HEADER PANEL */}
        <View style={styles.topNavigationRow}>
          <TouchableOpacity onPress={() => router.push('/')} style={styles.navHeaderBtn}>
            <Text style={styles.navHeaderBtnText}>← Exit Arena</Text>
          </TouchableOpacity>
          <Text style={{ color: '#555', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>DRAFT HUB ({rosterType})</Text>
          <TouchableOpacity onPress={() => router.push('/(admin)/league-settings')} style={[styles.navHeaderBtn, { borderColor: '#00ff87' }]}>
            <Text style={[styles.navHeaderBtnText, { color: '#00ff87' }]}>League Settings ⚙️</Text>
          </TouchableOpacity>
        </View>

        {/* TOP CLOCK DASHBOARD HUB */}
        <View style={[
          styles.clockBanner, 
          isMyTurn && styles.clockBannerActive,
          isMyTurn && timeLeft <= 15 && timeLeft > 5 && styles.clockBannerWarning,
          isMyTurn && timeLeft <= 5 && styles.clockBannerDanger
        ]}>
          <View>
            <Text style={styles.bannerMeta}>ROUND {currentRound} // OVERALL PICK #{overallPickIndex + 1}</Text>
            <Text style={styles.bannerTitle}>
              {isMyTurn ? "YOUR TURN - CHOOSE NOW" : "WAITING FOR MANAGERS..."}
            </Text>
          </View>
          <View style={[
            styles.timerBadge,
            isMyTurn && timeLeft <= 15 && timeLeft > 5 && { borderColor: '#ff9c00' },
            isMyTurn && timeLeft <= 5 && { borderColor: '#e63946', backgroundColor: '#260d10' }
          ]}>
            <Text style={[
              styles.timerText, 
              !isMyTurn && { color: '#444' },
              isMyTurn && timeLeft > 15 && { color: '#00ff87' }, 
              isMyTurn && timeLeft <= 15 && timeLeft > 5 && { color: '#ff9c00' }, 
              isMyTurn && timeLeft <= 5 && { color: '#e63946' }
            ]}>
              {timeLeft}s
            </Text>
          </View>
        </View>

        {/* PROXIMITY LOOKAHEAD TRACKER BAR */}
        <View style={[styles.queueIndicatorBar, isMyTurn && { backgroundColor: '#0D1A13', borderColor: '#00ff87' }]}>
          {isMyTurn ? (
            <Text style={[styles.queueText, { color: '#00ff87', fontWeight: '800' }]}>
              ⚡ YOU ARE ON THE CLOCK — SIGN YOUR PLAYER
            </Text>
          ) : picksUntilTurn === 1 ? (
            <Text style={[styles.queueText, { color: '#ff9c00', fontWeight: '700' }]}>
              ⚠️ ON DECK: You have the NEXT turn selection!
            </Text>
          ) : (
            <Text style={[styles.queueText, { color: '#888' }]}>
              Queue Status: <Text style={{ color: '#FFF', fontWeight: '700' }}>{picksUntilTurn}</Text> picks until your turn.
            </Text>
          )}
        </View>

        {/* SQUAD POSITION LIMITS QUOTAS */}
        <View style={styles.quotaTrackerBar}>
          <Text style={styles.quotaText}>YOUR ROSTER: </Text>
          <Text style={[styles.quotaBadge, mySquadCounts.GK >= 2 && { color: '#e63946' }]}>GKP: {mySquadCounts.GK}/2</Text>
          <Text style={[styles.quotaBadge, mySquadCounts.DEF >= (rosterType === 'FLEXIBLE' ? 6 : 5) && { color: '#e63946' }]}>
            DEF: {mySquadCounts.DEF}/{rosterType === 'FLEXIBLE' ? '6' : '5'}
          </Text>
          <Text style={[styles.quotaBadge, mySquadCounts.MID >= (rosterType === 'FLEXIBLE' ? 6 : 5) && { color: '#e63946' }]}>
            MID: {mySquadCounts.MID}/{rosterType === 'FLEXIBLE' ? '6' : '5'}
          </Text>
          <Text style={[styles.quotaBadge, mySquadCounts.FWD >= (rosterType === 'FLEXIBLE' ? 4 : 3) && { color: '#e63946' }]}>
            FWD: {mySquadCounts.FWD}/{rosterType === 'FLEXIBLE' ? '4' : '3'}
          </Text>
        </View>

        {/* SEARCH HEADER SECTION */}
        <View style={styles.searchHeader}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by player or club..."
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />
          
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false} 
            style={{ flexDirection: 'row', marginBottom: 8, maxHeight: 32 }}
            contentContainerStyle={{ gap: 4, paddingRight: 16 }}
          >
            <TouchableOpacity 
              style={[{ backgroundColor: '#1e1e1e', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#2d2d2d' }, selectedClub === null && { backgroundColor: '#00ff87', borderColor: '#00ff87' }]}
              onPress={() => setSelectedClub(null)}
            >
              <Text style={[{ color: '#aaa', fontSize: 11, fontWeight: 'bold' }, selectedClub === null && { color: '#121212' }]}>All Clubs</Text>
            </TouchableOpacity>

            {Array.from(new Set(allPlayers.map(p => p.team_code)))
              .filter(Boolean)
              .sort()
              .map((club) => {
                const isSelected = selectedClub === club;
                return (
                  <TouchableOpacity 
                    key={club}
                    style={[{ backgroundColor: '#1e1e1e', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#2d2d2d' }, isSelected && { backgroundColor: '#00ff87', borderColor: '#00ff87' }]}
                    onPress={() => setSelectedClub(isSelected ? null : club)}
                  >
                    <Text style={[{ color: '#aaa', fontSize: 11, fontWeight: 'bold' }, isSelected && { color: '#121212' }]}>{club}</Text>
                  </TouchableOpacity>
                );
              })}
          </ScrollView>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <View style={styles.filterBar}>
              <TouchableOpacity 
                style={[styles.filterChip, selectedPosition === null && styles.filterChipActive]}
                onPress={() => setSelectedPosition(null)}
              >
                <Text style={[styles.filterChipText, selectedPosition === null && styles.filterTextActive]}>ALL</Text>
              </TouchableOpacity>
              {[1, 2, 3, 4].map(pos => (
                <TouchableOpacity 
                  key={pos}
                  style={[styles.filterChip, selectedPosition === pos && styles.filterChipActive]}
                  onPress={() => setSelectedPosition(pos)}
                >
                  <Text style={[styles.filterChipText, selectedPosition === pos && styles.filterTextActive]}>
                    {POSITION_SHORTS[pos]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity 
              style={styles.sortToggle} 
              onPress={() => setSortByPoints(!sortByPoints)}
            >
              <Text style={styles.sortToggleText}>
                {sortByPoints ? '🔢 Sort: Points' : '🔤 Sort: A-Z'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* AVAILABLE PLAYERS RENDER LOOP */}
        <FlatList
          data={processedPlayerPool}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isPositionCapped = isPositionLocked(mySquadCounts, item.element_type);
            const disabledBtn = !isMyTurn || isPositionCapped;
            return (
              <View style={styles.playerCard}>
                <TouchableOpacity 
                  onPress={() => handleToggleWatchlist(item.fpl_id)}
                  style={{ paddingRight: 8, paddingLeft: 2, paddingVertical: 2 }}
                >
                  <Text style={{ fontSize: 24, color: watchlistPlayerIds.has(item.fpl_id) ? '#00ff87' : '#444', fontWeight: 'bold' }}>
                    {watchlistPlayerIds.has(item.fpl_id) ? '★' : '☆'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.playerMeta}
                  onPress={() => setSelectedModalPlayer(item)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.playerName}>
                    {item.web_name}
                    {watchlistPlayerIds.has(item.fpl_id) ? <Text style={{ color: '#00ff87' }}> ★</Text> : null}
                  </Text>
                  <Text style={styles.playerSubtext}>
                    <Text style={styles.positionTag}>{POSITION_SHORTS[item.element_type]}</Text> • {item.team_code} • {item.total_points} pts
                  </Text>
                </TouchableOpacity>
                
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <View style={styles.pointsBadge}>
                    <Text style={styles.pointsValue}>{item.total_points}</Text>
                    <Text style={styles.pointsLabel}>PTS</Text>
                  </View>
                  <TouchableOpacity 
                    disabled={disabledBtn}
                    style={[styles.draftButton, disabledBtn && { borderColor: '#222', backgroundColor: '#141414' }]} 
                    onPress={() => handleDraftPlayer(item)}
                  >
                    <Text style={[styles.draftButtonText, disabledBtn && { color: '#444' }]}>
                      {isPositionCapped ? 'LOCKED' : 'Sign'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No available matching players found.</Text>
          }
        />

        {/* QUICK-MOVE WATCHLIST OVERLAY ANCHOR BUTTON */}
        <View style={[styles.floatingWatchlistBtn, buttonDockPosition === 'top' ? { top: 140, bottom: 'auto' } : { bottom: 30, top: 'auto' }]}>
          <TouchableOpacity onPress={() => setShowWatchlistDrawer(true)} style={styles.floatingInnerTapTarget} activeOpacity={0.7}>
            <Text style={styles.floatingWatchlistBtnText}>📋 Watchlist ({watchlistedPlayers.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setButtonDockPosition(buttonDockPosition === 'bottom' ? 'top' : 'bottom')} style={styles.dockPositionToggle} activeOpacity={0.6}>
            <Text style={{ fontSize: 11, color: '#666', fontWeight: 'bold' }}>{buttonDockPosition === 'bottom' ? '⬆️ Shift' : '⬇️ Shift'}</Text>
          </TouchableOpacity>
        </View>

        {/* PREMIUM SPLIT-SECTION SCOUTING DOSSIER CARD MODAL */}
        <Modal visible={selectedModalPlayer !== null} animationType="slide" transparent={true} onRequestClose={() => setSelectedModalPlayer(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.playerCardContainer}>
              {selectedModalPlayer && (
                <>
                  <View style={[styles.cardAccentBar, (styles[`accentBg${POSITION_MAP_STR[selectedModalPlayer.element_type]}` as keyof typeof styles] as any)]} />
                  
                  <View style={styles.dossierLayoutHeader}>
                    <View style={styles.dossierMetaBlock}>
                      <View style={styles.badgeRow}>
                        <View style={[styles.roleLabelBadge, (styles[`accentBg${POSITION_MAP_STR[selectedModalPlayer.element_type]}` as keyof typeof styles] as any)]}>
                          <Text style={styles.roleLabelBadgeText}>{POSITION_SHORTS[selectedModalPlayer.element_type]}</Text>
                        </View>
                        <Text style={styles.clubStampText}>{`${selectedModalPlayer.team_code.toUpperCase()} // ACTIVE ROSTER`}</Text>
                      </View>
                      <Text style={styles.dossierPlayerName}>{selectedModalPlayer.web_name}</Text>
                      <Text style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{`${selectedModalPlayer.first_name} ${selectedModalPlayer.second_name}`}</Text>
                    </View>
                    <View style={styles.dossierScoreWidget}>
                      <Text style={styles.dossierScoreNumber}>{selectedModalPlayer.total_points}</Text>
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
                    {loadingHistory ? (
                      <View style={{ padding: 30, justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                        <ActivityIndicator size="small" color="#00ff87" />
                      </View>
                    ) : modalTab === 'HISTORY' ? (
                      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled={true}>
                        <View style={styles.statsTableHeader}>
                          <Text style={[styles.statsTh, { width: '25%' }]}>SEASON</Text>
                          <Text style={[styles.statsTh, { width: '18%' }]}>GOALS</Text>
                          <Text style={[styles.statsTh, { width: '18%' }]}>ASSISTS</Text>
                          <Text style={[styles.statsTh, { width: '18%' }]}>CLEAN</Text>
                          <Text style={[styles.statsTh, { width: '21%', textAlign: 'right' }]}>TOTAL</Text>
                        </View>
                        {pastHistory.length === 0 ? (
                          <Text style={styles.emptyText}>No previous career records registered in database.</Text>
                        ) : (
                          pastHistory.map((season, i) => (
                            <View key={i} style={styles.statsTableRow}>
                              <Text style={[styles.statsTd, { width: '25%', color: '#FFF' }]}>{season.season_name}</Text>
                              <Text style={[styles.statsTd, { width: '18%' }]}>{season.goals_scored}</Text>
                              <Text style={[styles.statsTd, { width: '18%' }]}>{season.assists}</Text>
                              <Text style={[styles.statsTd, { width: '18%' }]}>{season.clean_sheets}</Text>
                              <Text style={[styles.statsTd, { width: '21%', textAlign: 'right', color: '#00ff87', fontWeight: '700' }]}>{`${season.total_points} pts`}</Text>
                            </View>
                          ))
                        )}
                      </ScrollView>
                    ) : (
                      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled={true}>
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
                              <Text style={[styles.statsTd, { width: '20%', color: '#666', fontWeight: '700' }]}>{`GW ${fix.event}`}</Text>
                              <Text style={[styles.statsTd, { width: '55%', color: '#E0E0E0' }]}>
                                {`${fix.opponent_name} ${fix.is_home ? '(H)' : '(A)'}`}
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
                    <TouchableOpacity 
                      style={[styles.dossierWatchlistBtn, watchlistPlayerIds.has(selectedModalPlayer.fpl_id) && styles.dossierWatchlistBtnActive]} 
                      onPress={() => handleToggleWatchlist(selectedModalPlayer.fpl_id)}
                    >
                      <Text style={[styles.dossierWatchlistBtnText, watchlistPlayerIds.has(selectedModalPlayer.fpl_id) && styles.dossierWatchlistBtnTextActive]}>
                        {watchlistPlayerIds.has(selectedModalPlayer.fpl_id) ? '★ REMOVE SHORTLIST' : '☆ ADD TO WATCHLIST'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      disabled={!isMyTurn || isPositionLocked(mySquadCounts, selectedModalPlayer.element_type)}
                      style={[styles.modalSignBtn, (!isMyTurn || isPositionLocked(mySquadCounts, selectedModalPlayer.element_type)) && { backgroundColor: '#222' }]} 
                      onPress={() => handleDraftPlayer(selectedModalPlayer)}
                    >
                      <Text style={[styles.modalSignBtnText, (!isMyTurn || isPositionLocked(mySquadCounts, selectedModalPlayer.element_type)) && { color: '#444' }]}>DRAFT ASSET</Text>
                    </TouchableOpacity>
                  </View>
                  
                  <TouchableOpacity style={[styles.dossierCloseBtn, { marginTop: 10 }]} onPress={() => setSelectedModalPlayer(null)}>
                    <Text style={styles.dossierCloseBtnText}>DISMISS SCOUTING REPORT</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* SLIDE-OUT WATCHLIST OVERLAY DRAWER */}
        <Modal visible={showWatchlistDrawer} animationType="slide" transparent={true} onRequestClose={() => setShowWatchlistDrawer(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '75%' }]}>
              <View style={[styles.modalHeader, { flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center' }]}>
                <Text style={styles.screenTitle}>📋 Watchlisted Targets</Text>
                <TouchableOpacity onPress={() => setShowWatchlistDrawer(false)} style={{ padding: 4 }}>
                  <Text style={{ color: '#666', fontSize: 24, fontWeight: 'bold' }}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.divider} />

              <FlatList
                data={watchlistedPlayers}
                keyExtractor={(item) => 'watch-' + item.id}
                style={{ marginVertical: 8 }}
                renderItem={({ item }) => (
                  <View style={[styles.playerCard, { marginHorizontal: 0, backgroundColor: '#222' }]}>
                    <TouchableOpacity style={styles.playerMeta} onPress={() => setSelectedModalPlayer(item)} activeOpacity={0.6}>
                      <Text style={styles.playerName}>
                        {item.web_name}
                        {watchlistPlayerIds.has(item.fpl_id) ? <Text style={{ color: '#00ff87' }}> ★</Text> : null}
                      </Text>
                      <Text style={styles.playerSubtext}>
                        <Text style={styles.positionTag}>{POSITION_SHORTS[item.element_type]}</Text> • {item.team_code} • {item.total_points} pts
                      </Text>
                    </TouchableOpacity>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      <Text style={{ color: '#00ff87', fontWeight: 'bold', fontSize: 15 }}>{item.total_points} pts</Text>
                      <TouchableOpacity 
                        disabled={!isMyTurn || isPositionLocked(mySquadCounts, item.element_type)}
                        style={[styles.draftButton, { borderColor: '#00ff87' }, (!isMyTurn || isPositionLocked(mySquadCounts, item.element_type)) && { borderColor: '#333' }]} 
                        onPress={() => handleDraftPlayer(item)}
                      >
                        <Text style={[styles.draftButtonText, (!isMyTurn || isPositionLocked(mySquadCounts, item.element_type)) && { color: '#444' }]}>Sign</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                ListEmptyComponent={
                  <Text style={[styles.emptyText, { marginVertical: 30 }]}>Your watchlist database is currently empty.</Text>
                }
              />

              <TouchableOpacity style={[styles.closeModalBtn, { width: '100%', marginTop: 12 }]} onPress={() => setShowWatchlistDrawer(false)}>
                <Text style={styles.closeModalBtnText}>Back to Main Draft Pool</Text>
              </TouchableOpacity>
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
  
  topNavigationRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#0F0F0F', borderBottomWidth: 1, borderColor: '#161616' },
  navHeaderBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, borderWidth: 1, borderColor: '#222', backgroundColor: '#111' },
  navHeaderBtnText: { color: '#888', fontSize: 11, fontWeight: '700' },

  clockBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#111', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  clockBannerActive: { borderColor: '#00ff87', borderWidth: 1, backgroundColor: '#0D1A13' },
  clockBannerWarning: { borderColor: '#ff9c00', backgroundColor: '#241600', borderWidth: 1 },
  clockBannerDanger: { borderColor: '#e63946', backgroundColor: '#1C0A0C', borderWidth: 1 },
  bannerMeta: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  bannerTitle: { color: '#FFF', fontSize: 15, fontWeight: '800', marginTop: 1 },
  timerBadge: { backgroundColor: '#000', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: '#2d2d2d' },
  timerText: { fontSize: 16, fontWeight: '900' },
  
  queueIndicatorBar: { backgroundColor: '#161616', paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#242424' },
  queueText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },

  quotaTrackerBar: { flexDirection: 'row', backgroundColor: '#0f0f0f', paddingVertical: 8, paddingHorizontal: 16, gap: 12, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  quotaText: { color: '#444', fontSize: 9, fontWeight: '800' },
  quotaBadge: { color: '#aaa', fontSize: 11, fontWeight: '600' },

  searchHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  screenTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  searchInput: { backgroundColor: '#1e1e1e', color: '#fff', height: 46, borderRadius: 8, paddingHorizontal: 16, fontSize: 14, borderWidth: 1, borderColor: '#2d2d2d', marginTop: 4, marginBottom: 8 },
  filterBar: { flexDirection: 'row', gap: 4 },
  filterChip: { backgroundColor: '#1e1e1e', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#2d2d2d' },
  filterChipActive: { backgroundColor: '#00ff87', borderColor: '#00ff87' },
  filterChipText: { color: '#aaa', fontSize: 11, fontWeight: 'bold' },
  filterTextActive: { color: '#121212' },
  sortToggle: { backgroundColor: '#222', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#333' },
  sortToggleText: { color: '#00ff87', fontSize: 11, fontWeight: 'bold' },

  playerCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1a1a1a', marginHorizontal: 8, marginTop: 4, padding: 6, borderRadius: 6, borderWidth: 1, borderColor: '#242424' },
  playerMeta: { flex: 1, marginRight: 8, paddingVertical: 1 },
  playerName: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
  playerSubtext: { fontSize: 12, color: '#888', marginTop: 2 },
  positionTag: { color: '#00ff87', fontWeight: 'bold' },
  
  pointsBadge: { alignItems: 'center', minWidth: 32 },
  pointsValue: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  pointsLabel: { color: '#666', fontSize: 9, fontWeight: 'bold', marginTop: 1 },

  draftButton: { backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: '#00ff87', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4 },
  draftButtonText: { color: '#00ff87', fontSize: 12, fontWeight: 'bold' },
  emptyText: { color: '#444', fontSize: 12, textAlign: 'center', marginVertical: 20, fontWeight: '600' },

  floatingWatchlistBtn: { position: 'absolute', right: 20, backgroundColor: '#1e1e1e', borderWidth: 1.5, borderColor: '#00ff87', borderRadius: 23, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 5, elevation: 8, zIndex: 99 },
  floatingInnerTapTarget: { paddingLeft: 16, paddingRight: 12, height: 46, justifyContent: 'center', alignItems: 'center' },
  floatingWatchlistBtnText: { color: '#00ff87', fontWeight: 'bold', fontSize: 13 },
  dockPositionToggle: { borderLeftWidth: 1, borderLeftColor: '#2d2d2d', paddingHorizontal: 12, height: 46, justifyContent: 'center', alignItems: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24, borderWidth: 1, borderColor: '#2d2d2d', borderBottomWidth: 0 },
  
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
  dossierMainDisplayArea: { backgroundColor: '#111', borderRadius: 4, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: '#141414', minHeight: 240 },
  statsTableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1A1A1A', paddingBottom: 6, marginBottom: 8 },
  statsTh: { color: '#333', fontSize: 9, fontWeight: '800' },
  statsTableRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#151515', alignItems: 'center' },
  statsTd: { color: '#888', fontSize: 12, fontWeight: '500' },
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
  dossierCloseBtn: { flex: 1, backgroundColor: 'transparent', height: 44, borderRadius: 4, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#1C1C1C' },
  dossierCloseBtnText: { color: '#444', fontSize: 12, fontWeight: '700' },

  divider: { height: 1, backgroundColor: '#2d2d2d', marginVertical: 8 },
  modalHeader: { alignItems: 'center', marginBottom: 16 },
  closeModalBtn: { flex: 1, backgroundColor: '#262626', height: 48, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  closeModalBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modalSignBtn: { flex: 4, backgroundColor: '#00ff87', height: 44, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  modalSignBtnText: { color: '#121212', fontSize: 12, fontWeight: 'bold' }
});