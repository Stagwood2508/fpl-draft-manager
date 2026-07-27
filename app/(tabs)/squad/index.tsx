import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
  TouchableOpacity,
  Image
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../../../utils/supabase';
import KitIcon from '@/components/KitIcon'; // 🌟 Official 2026/27 Vector Kit Component

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PlayerData {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  element_type: string; // 'GKP', 'DEF', 'MID', 'FWD'
  team_id?: number;
  team_name: string;
  photo_code?: number;
}

interface RosterItem {
  id: string;
  is_starting: boolean; 
  is_gk: boolean;
  bench_order: number | null; 
  player_id: number;
  players: PlayerData;
}

// --- HELPER TO CLEAN DUPLICATE BENCH INDEXES ---
const sanitizeRosterPositions = (players: RosterItem[]): RosterItem[] => {
  const starters = players.filter(p => p.is_starting);
  
  // Separate GKP subs from outfield subs
  const benchGk = players.filter(p => !p.is_starting && p.players?.element_type === 'GKP');
  const benchOutfield = players.filter(p => !p.is_starting && p.players?.element_type !== 'GKP')
    .sort((a, b) => (a.bench_order ?? 99) - (b.bench_order ?? 99));

  // Auto-assign clean outfield bench indexes 1, 2, 3...
  const cleanedOutfieldBench = benchOutfield.map((player, index) => ({
    ...player,
    bench_order: index + 1
  }));

  return [...starters, ...benchGk, ...cleanedOutfieldBench];
};

export default function SquadScreen() {
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [swappingPlayerId, setSwappingPlayerId] = useState<string | null>(null);
  const [failedImageIds, setFailedImageIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (isFocused) {
      fetchSquadRoster();
    }
  }, [isFocused]);

  const fetchSquadRoster = async () => {
    try {
      setLoading(true);
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error('Authentication frame unverified.');

      const { data: memberData, error: memberErr } = await supabase
        .from('league_members')
        .select('league_id')
        .limit(1)
        .single();

      if (memberErr || !memberData) throw new Error('No assigned league membership profile identified.');

      const { data: rosterData, error: rosterErr } = await supabase
        .from('rosters')
        .select(`
          id,
          is_starting,
          is_gk,
          bench_order,
          player_id,
          players(id, first_name, second_name, web_name, element_type, team_id, team_name, photo_code)
        `)
        .eq('league_id', memberData.league_id)
        .eq('user_id', user.id);

      if (rosterErr) throw rosterErr;

      const rawRoster = (rosterData || []).map((item: any) => {
        const playerDetails = Array.isArray(item.players) ? item.players[0] : item.players;
        return {
          id: item.id,
          is_starting: item.is_starting,
          is_gk: item.is_gk,
          bench_order: item.bench_order,
          player_id: item.player_id,
          players: playerDetails
        };
      }) as unknown as RosterItem[];

      // 🟢 PASS THROUGH SANITIZER TO REMOVE DUPLICATE BENCH ORDERS
      const sanitizedRoster = sanitizeRosterPositions(rawRoster);

      setRoster(sanitizedRoster);
      validateSquadLimits(sanitizedRoster);
    } catch (err: any) {
      Alert.alert('Squad Sync Failure', err.message);
    } finally {
      setLoading(false);
    }
  };

  const validateSquadLimits = (items: RosterItem[]) => {
    const counts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    items.forEach(item => {
      if (item.players?.element_type) {
        counts[item.players.element_type as 'GKP' | 'DEF' | 'MID' | 'FWD'] += 1;
      }
    });

    const errors: string[] = [];
    if (counts['GKP'] > 2) errors.push(`Goalkeepers (${counts['GKP']}/2) exceed maximum bounds.`);
    if (counts['DEF'] > 5) errors.push(`Defenders (${counts['DEF']}/5) exceed maximum bounds.`);
    if (counts['MID'] > 5) errors.push(`Midfielders (${counts['MID']}/5) exceed maximum bounds.`);
    if (counts['FWD'] > 3) errors.push(`Forwards (${counts['FWD']}/3) exceed maximum bounds.`);

    setValidationErrors(errors);
  };

  const handlePlayerPress = async (rosterId: string) => {
    // If no player is selected yet, select this one
    if (!swappingPlayerId) {
      setSwappingPlayerId(rosterId);
      return;
    }

    // If tapping the same player again, deselect
    if (swappingPlayerId === rosterId) {
      setSwappingPlayerId(null);
      return;
    }

    const playerA = roster.find(r => r.id === swappingPlayerId);
    const playerB = roster.find(r => r.id === rosterId);

    if (!playerA || !playerB) {
      setSwappingPlayerId(null);
      return;
    }

    // 🧤 GOALKEEPER RESTRICTION: GKP can only swap with GKP
    const isPlayerAGk = playerA.players?.element_type === 'GKP';
    const isPlayerBGk = playerB.players?.element_type === 'GKP';

    if ((isPlayerAGk || isPlayerBGk) && !(isPlayerAGk && isPlayerBGk)) {
      Alert.alert("Position Locked", "Goalkeepers can only be swapped with the starting Goalkeeper.");
      setSwappingPlayerId(null);
      return;
    }

    // Check if both are bench players (Bench-to-bench reordering)
    if (!playerA.is_starting && !playerB.is_starting) {
      try {
        setLoading(true);
        // Swap bench orders
        await Promise.all([
          supabase.from('rosters').update({ bench_order: playerB.bench_order }).eq('id', playerA.id),
          supabase.from('rosters').update({ bench_order: playerA.bench_order }).eq('id', playerB.id)
        ]);
        setSwappingPlayerId(null);
        await fetchSquadRoster();
        return;
      } catch (err: any) {
        Alert.alert("Reorder Failed", err.message);
        setSwappingPlayerId(null);
        setLoading(false);
        return;
      }
    }

    // Otherwise, it's a Pitch ⇄ Bench Substitution. Validate formation rules.
    const updatedRoster = roster.map(item => {
      if (item.id === playerA.id) return { ...item, is_starting: playerB.is_starting };
      if (item.id === playerB.id) return { ...item, is_starting: playerA.is_starting };
      return item;
    });

    const starters = updatedRoster.filter(r => r.is_starting);
    const gkps = starters.filter(s => s.players?.element_type === 'GKP').length;
    const defs = starters.filter(s => s.players?.element_type === 'DEF').length;
    const mids = starters.filter(s => s.players?.element_type === 'MID').length;
    const fwds = starters.filter(s => s.players?.element_type === 'FWD').length;

    if (gkps !== 1 || defs < 3 || mids < 2 || fwds < 1) {
      Alert.alert("Formation Blocked", "Invalid formation rules (Min: 1 GKP, 3 DEF, 2 MID, 1 FWD).");
      setSwappingPlayerId(null);
      return;
    }

    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      const { data: memberData } = await supabase.from('league_members').select('league_id').limit(1).single();

      if (!user || !memberData) throw new Error("Authentication error.");

      // 🌟 EXECUTE ATOMIC SQL RPC SWAP
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('swap_roster_players', {
        p_league_id: memberData.league_id,
        p_user_id: user.id,
        p_player_1_id: playerA.player_id,
        p_player_2_id: playerB.player_id
      });

      if (rpcErr || (rpcRes && rpcRes.success === false)) {
        throw new Error(rpcRes?.error || rpcErr?.message || "Failed to execute substitution.");
      }

      setSwappingPlayerId(null);
      await fetchSquadRoster();
    } catch (err: any) {
      Alert.alert("Substitution Failed", err.message);
      setSwappingPlayerId(null);
      setLoading(false);
    }
  };

  const handleImageError = (playerId: number) => {
    setFailedImageIds(prev => new Set(prev).add(playerId));
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00ff87" />
      </View>
    );
  }

  const startersList = roster.filter(r => r.is_starting);
  const benchGkList = roster.filter(r => !r.is_starting && r.players?.element_type === 'GKP');
  const benchOutfieldList = roster
    .filter(r => !r.is_starting && r.players?.element_type !== 'GKP')
    .sort((a, b) => (a.bench_order ?? 9) - (b.bench_order ?? 9));

  const renderPlayerBadge = (item: RosterItem, overrideBenchIndex?: number) => {
    const isSelected = swappingPlayerId === item.id;
    let priorityTag = item.players?.element_type || '';
    
    if (!item.is_starting) {
      if (item.players?.element_type === 'GKP') {
        priorityTag = 'GKP (Sub)';
      } else {
        const orderNumber = overrideBenchIndex ?? item.bench_order ?? 1;
        priorityTag = `Sub ${orderNumber}`;
      }
    }

    const playerId = item.players?.id;
    const photoCode = item.players?.photo_code || item.players?.id;
    const hasImageFailed = failedImageIds.has(playerId);

    return (
      <TouchableOpacity 
        key={item.id} 
        style={[styles.playerCard, isSelected && styles.pitchNodeSelected]}
        onPress={() => handlePlayerPress(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.avatarContainer}>
          {photoCode && !hasImageFailed ? (
            <Image
              source={{ uri: `https://resources.premierleague.com/premierleague/photos/players/250x250/p${photoCode}.png` }}
              style={styles.playerHeadshot}
              resizeMode="contain"
              onError={() => handleImageError(playerId)}
            />
          ) : (
            <KitIcon teamId={item.players?.team_id || 0} size={34} />
          )}
        </View>

        <Text style={styles.playerName} numberOfLines={1}>
          {item.players?.web_name || 'Empty'}
        </Text>
        <Text style={styles.playerSub}>
          {priorityTag}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {validationErrors.length > 0 && (
        <View style={styles.errorBanner}>
          {validationErrors.map((err, idx) => (
            <Text key={idx} style={styles.errorText}>⚠️ {err}</Text>
          ))}
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.pitchFrame}>
          <View style={styles.pitchLines}>
            <View style={styles.penaltyAreaTop} />
            <View style={styles.centerLine} />
            <View style={styles.centerCircle} />
          </View>

          {/* STARTING LINEUP ON PITCH */}
          <View style={styles.pitchRow}>
            {startersList.filter(s => s.players?.element_type === 'GKP').map(p => renderPlayerBadge(p))}
          </View>
          <View style={styles.pitchRow}>
            {startersList.filter(s => s.players?.element_type === 'DEF').map(p => renderPlayerBadge(p))}
          </View>
          <View style={styles.pitchRow}>
            {startersList.filter(s => s.players?.element_type === 'MID').map(p => renderPlayerBadge(p))}
          </View>
          <View style={styles.pitchRow}>
            {startersList.filter(s => s.players?.element_type === 'FWD').map(p => renderPlayerBadge(p))}
          </View>
        </View>

        <Text style={styles.benchHeader}>Substitutes Bench (Tap two players to substitute)</Text>
        
        {/* BENCH CONTAINER */}
        <View style={styles.benchContainer}>
          {benchGkList.length === 0 && benchOutfieldList.length === 0 ? (
            <Text style={styles.emptyBenchText}>No bench replacements assigned.</Text>
          ) : (
            <>
              <View style={styles.benchGroupSection}>
                {benchGkList.map(p => renderPlayerBadge(p))}
              </View>

              <View style={styles.benchDivider} />

              <View style={styles.benchGroupSection}>
                {benchOutfieldList.map((p, idx) => renderPlayerBadge(p, idx + 1))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
  errorBanner: { backgroundColor: '#2C0D0E', borderBottomWidth: 1, borderBottomColor: '#FF3B30', padding: 10 },
  errorText: { color: '#FF453A', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  scrollContent: { paddingBottom: 30 },
  pitchFrame: { backgroundColor: '#14381B', borderWidth: 2, borderColor: '#5F8566', borderRadius: 8, margin: 12, height: 480, justifyContent: 'space-around', paddingVertical: 10, overflow: 'hidden', position: 'relative' },
  pitchLines: { ...StyleSheet.absoluteFillObject, opacity: 0.2, justifyContent: 'center', alignItems: 'center' },
  penaltyAreaTop: { position: 'absolute', top: -2, width: 180, height: 80, borderWidth: 1.5, borderColor: '#A2C4A6' },
  centerLine: { position: 'absolute', width: '100%', height: 1.5, backgroundColor: '#A2C4A6' },
  centerCircle: { width: 110, height: 110, borderRadius: 55, borderWidth: 1.5, borderColor: '#A2C4A6' },
  pitchRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', width: '100%', zIndex: 10 },
  playerCard: { alignItems: 'center', width: SCREEN_WIDTH / 5.5, marginHorizontal: 2, padding: 4, borderRadius: 4 },
  pitchNodeSelected: { backgroundColor: '#00ff8722', borderWidth: 1, borderColor: '#00ff87', borderRadius: 6 },
  avatarContainer: { width: 38, height: 38, justifyContent: 'center', alignItems: 'center' },
  playerHeadshot: { width: 38, height: 38 },
  playerName: { color: '#FFF', fontSize: 10, fontWeight: '800', marginTop: 4, backgroundColor: '#000000BA', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 2, textAlign: 'center', width: '100%' },
  playerSub: { color: '#00ff87', fontSize: 8, fontWeight: '700', marginTop: 1 },
  benchHeader: { fontSize: 12, fontWeight: '900', color: '#888', textTransform: 'uppercase', marginLeft: 16, marginTop: 10, letterSpacing: 1 },
  benchContainer: { flexDirection: 'row', backgroundColor: '#111', margin: 12, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: '#222', minHeight: 95, alignItems: 'center', justifyContent: 'center' },
  benchGroupSection: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  benchDivider: { width: 2, height: 45, backgroundColor: '#00ff8755', marginHorizontal: 10, borderRadius: 1 },
  emptyBenchText: { color: '#444', fontSize: 12, width: '100%', textAlign: 'center', fontWeight: '600' },
});