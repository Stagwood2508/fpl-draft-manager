import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  FlatList, 
  RefreshControl,
  TouchableOpacity, 
  ActivityIndicator,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from 'expo-router/react-navigation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import PlayerCardModal from '@/components/PlayerCardModal';
import { AppColors } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

interface PlayerAsset {
  id: number;
  web_name: string;
  team_name: string;
  element_type: string;
  total_points: number;
}

const POSITION_COLORS: Record<string, string> = {
  GKP: '#FFC107',
  DEF: '#00A2FF',
  MID: '#00FF87',
  FWD: '#FF0055',
};

export default function WatchlistScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [currentGameweek, setCurrentGameweek] = useState<number>(1);
  
  const [watchlistPlayers, setWatchlistPlayers] = useState<PlayerAsset[]>([]);
  const [filteredPlayers, setFilteredPlayers] = useState<PlayerAsset[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<string>('ALL');

  const [selectedModalPlayerId, setSelectedModalPlayerId] = useState<number | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  const positions = ['ALL', 'GKP', 'DEF', 'MID', 'FWD'];

  useEffect(() => {
    if (isFocused) {
      loadWatchlistEngine();
    }
  }, [isFocused]);

  useEffect(() => {
    if (selectedPosition === 'ALL') {
      setFilteredPlayers(watchlistPlayers);
    } else {
      setFilteredPlayers(watchlistPlayers.filter(p => p.element_type === selectedPosition));
    }
  }, [selectedPosition, watchlistPlayers]);

  const loadWatchlistEngine = async () => {
    try {
      setLoading(true);

      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error('User authentication token invalid.');

      // 1. Resolve Active League ID from AsyncStorage
      let currentLeagueId = await AsyncStorage.getItem('active_league_id');

      if (!currentLeagueId) {
        const { data: memberData, error: memberErr } = await supabase
          .from('league_members')
          .select('league_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        if (!memberErr && memberData?.league_id) {
          const membershipLeagueId = memberData.league_id;
          currentLeagueId = membershipLeagueId;
          await AsyncStorage.setItem('active_league_id', membershipLeagueId);
        }
      }

      if (!currentLeagueId) throw new Error('No assigned active league identified.');
      setActiveLeagueId(currentLeagueId);

      // 2. Fetch active gameweek
      const { data: leagueGwData } = await supabase
        .from('league_gameweeks')
        .select('gameweek')
        .eq('league_id', currentLeagueId)
        .order('gameweek', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (leagueGwData) {
        setCurrentGameweek(leagueGwData.gameweek);
      }

      // 3. Fetch positional overrides for this active league
      let overridesMap: Record<number, string> = {};
      const { data: overridesData } = await supabase
        .from('league_player_overrides')
        .select('player_id, custom_position')
        .eq('league_id', currentLeagueId);

      if (overridesData) {
        overridesData.forEach(o => { overridesMap[o.player_id] = o.custom_position; });
      }

      // 4. Query Watchlist records joined with players strictly for current active league
      const { data: wlData, error: wlErr } = await supabase
        .from('watchlists')
        .select(`
          player_id,
          players ( id, web_name, team_name, element_type, total_points )
        `)
        .eq('user_id', user.id)
        .eq('league_id', currentLeagueId);

      if (wlErr) throw wlErr;

      const players = (wlData || [])
        .map((item: any) => {
          const p = item.players as PlayerAsset;
          if (!p) return null;
          return {
            ...p,
            element_type: overridesMap[p.id] || p.element_type
          };
        })
        .filter(Boolean) as PlayerAsset[];

      players.sort((a, b) => b.total_points - a.total_points);

      setWatchlistPlayers(players);
      setFilteredPlayers(players);
    } catch (err: any) {
      Alert.alert('Watchlist Sync Error', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadWatchlistEngine();
  }, []);

  const handleRemoveItem = async (playerId: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !activeLeagueId) return;

      const { error } = await supabase
        .from('watchlists')
        .delete()
        .eq('user_id', user.id)
        .eq('league_id', activeLeagueId)
        .eq('player_id', playerId);

      if (error) throw error;

      const updatedList = watchlistPlayers.filter(p => p.id !== playerId);
      setWatchlistPlayers(updatedList);
    } catch (err: any) {
      Alert.alert('Removal Aborted', err.message);
    }
  };

  const getShortTeamCode = (name: string) => (name ? name.slice(0, 3).toUpperCase() : 'FA');

  const renderPlayerItem = ({ item }: { item: PlayerAsset }) => {
    const mappedPositionColor = POSITION_COLORS[item.element_type] || '#222';

    return (
      <View style={styles.playerRow}>
        <TouchableOpacity 
          style={styles.playerCardMainTrigger}
          onPress={() => {
            setSelectedModalPlayerId(item.id);
            setDetailsVisible(true);
          }}
          activeOpacity={0.7}
        >
          <View style={styles.playerMeta}>
            <View style={styles.playerRowFlow}>
              <Text style={styles.playerName} numberOfLines={1}>{item.web_name}</Text>
              <Text style={styles.playerClubShort}>{getShortTeamCode(item.team_name)}</Text>
              <View style={[styles.positionBadgeChip, { backgroundColor: mappedPositionColor }]}>
                <Text style={styles.positionChipText}>{item.element_type}</Text>
              </View>
            </View>
          </View>
          <View style={styles.pointsColumn}>
            <Text style={styles.pointsValueText}>{item.total_points}</Text>
            <Text style={styles.pointsLabelText}>PTS</Text>
          </View>
        </TouchableOpacity>
        
        {/* RED TRASH BIN ICON (FURTHEST RIGHT) */}
        <TouchableOpacity 
          style={styles.removeBtn}
          onPress={() => handleRemoveItem(item.id)}
          activeOpacity={0.8}
        >
          <Ionicons name="trash-outline" size={15} color={colors.danger} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeContainer} edges={['bottom', 'left', 'right']}>
      {/* POSITION FILTERS */}
      <View style={styles.pillsContainerRow}>
        {positions.map(pos => (
          <TouchableOpacity
            key={pos}
            style={[styles.pillBtn, selectedPosition === pos && styles.pillBtnActive]}
            onPress={() => setSelectedPosition(pos)}
          >
            <Text style={[styles.pillText, selectedPosition === pos && styles.pillTextActive]}>{pos}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* WATCHLIST FEED */}
      {loading && !refreshing ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={filteredPlayers}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderPlayerItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="bookmark-outline" size={48} color={colors.textDisabled} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>Your watchlist is empty.</Text>
              <Text style={styles.emptySubText}>Tap bookmarks on the Scout screen to queue key recruitment targets here.</Text>
            </View>
          }
        />
      )}

      {/* REUSABLE PLAYER CARD MODAL */}
      <PlayerCardModal 
        visible={detailsVisible}
        playerId={selectedModalPlayerId}
        leagueId={activeLeagueId}
        currentGameweek={currentGameweek}
        onClose={() => {
          setDetailsVisible(false);
          setSelectedModalPlayerId(null);
        }}
      />
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safeContainer: { flex: 1, backgroundColor: colors.background, paddingTop: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  
  pillsContainerRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 16 },
  pillBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, marginRight: 6 },
  pillBtnActive: { backgroundColor: colors.accentFill, borderColor: colors.accent },
  pillText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' },
  pillTextActive: { color: colors.accentForeground, fontWeight: '900' },

  playerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingRight: 8, borderRadius: 4, marginBottom: 4 },
  playerCardMainTrigger: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8 },
  playerMeta: { flex: 1, marginLeft: 2, paddingRight: 4, justifyContent: 'center' },
  playerRowFlow: { flexDirection: 'row', alignItems: 'center' },
  playerName: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', marginRight: 8 },
  playerClubShort: { color: colors.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginRight: 8 },
  positionBadgeChip: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2, justifyContent: 'center', alignItems: 'center' },
  positionChipText: { color: colors.black, fontSize: 8, fontWeight: '900', letterSpacing: 0.1 },
  
  pointsColumn: { alignItems: 'center', justifyContent: 'center', marginRight: 8, minWidth: 28 },
  pointsValueText: { color: colors.accent, fontSize: 14, fontWeight: '900' },
  pointsLabelText: { color: colors.textDisabled, fontSize: 7, fontWeight: '900', marginTop: -3 },
  
  removeBtn: { width: 36, height: 28, backgroundColor: colors.dangerSoft, borderRadius: 4, borderWidth: 1, borderColor: colors.dangerBorder, justifyContent: 'center', alignItems: 'center' },
  
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 80, paddingHorizontal: 32 },
  emptyText: { color: colors.textPrimary, textAlign: 'center', fontWeight: '800', fontSize: 15, marginBottom: 6 },
  emptySubText: { color: colors.textMuted, textAlign: 'center', fontWeight: '600', fontSize: 12, lineHeight: 18 }
});
