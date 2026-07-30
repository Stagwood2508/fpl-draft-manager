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
import { supabase } from '@/utils/supabase';
import KitIcon from '@/components/KitIcon';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PlayerData {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  element_type: 'GKP' | 'DEF' | 'MID' | 'FWD' | string;
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

const sanitizeRosterPositions = (players: RosterItem[]): RosterItem[] => {
  const starters = players.filter(p => p.is_starting);
  
  const benchGk = players.filter(p => !p.is_starting && p.players?.element_type === 'GKP')
    .map(p => ({ ...p, bench_order: 0 }));

  const benchOutfield = players.filter(p => !p.is_starting && p.players?.element_type !== 'GKP')
    .sort((a, b) => (a.bench_order ?? 99) - (b.bench_order ?? 99));

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
  const [rosterType, setRosterType] = useState<'STRICT' | 'FLEXIBLE'>('STRICT');
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

      // 1. Fetch Roster Rules Configuration
      const { data: settings } = await supabase
        .from('league_settings')
        .select('roster_type')
        .eq('league_id', memberData.league_id)
        .maybeSingle();

      const activeRosterType = (settings?.roster_type as 'STRICT' | 'FLEXIBLE') || 'STRICT';
      setRosterType(activeRosterType);

      // 2. Fetch Roster Items
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

      const sanitizedRoster = sanitizeRosterPositions(rawRoster);

      setRoster(sanitizedRoster);
      validateSquadLimits(sanitizedRoster, activeRosterType);
    } catch (err: any) {
      Alert.alert('Squad Sync Failure', err.message);
    } finally {
      setLoading(false);
    }
  };

  const validateSquadLimits = (items: RosterItem[], mode: 'STRICT' | 'FLEXIBLE') => {
    const starters = items.filter(i => i.is_starting);
    const errors: string[] = [];

    const starterCounts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    const totalCounts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };

    items.forEach(item => {
      if (item.players?.element_type) {
        const pos = item.players.element_type as keyof typeof totalCounts;
        if (totalCounts[pos] !== undefined) totalCounts[pos] += 1;
        if (item.is_starting && starterCounts[pos] !== undefined) starterCounts[pos] += 1;
      }
    });

    // Formation Rules (Applies to BOTH Strict and Flexible)
    if (starters.length !== 11) errors.push(`Starting XI must have exactly 11 players (Currently ${starters.length}).`);
    if (starterCounts.GKP !== 1) errors.push(`Must have exactly 1 starting Goalkeeper.`);
    if (starterCounts.DEF < 3) errors.push(`Must start at least 3 Defenders (Currently ${starterCounts.DEF}).`);
    if (starterCounts.MID < 2) errors.push(`Must start at least 2 Midfielders (Currently ${starterCounts.MID}).`);
    if (starterCounts.FWD < 1) errors.push(`Must start at least 1 Forward (Currently ${starterCounts.FWD}).`);

    // Strict Mode Maximum Limits
    if (mode === 'STRICT') {
      if (totalCounts.GKP > 2) errors.push(`Goalkeepers (${totalCounts.GKP}/2) exceed strict limits.`);
      if (totalCounts.DEF > 5) errors.push(`Defenders (${totalCounts.DEF}/5) exceed strict limits.`);
      if (totalCounts.MID > 5) errors.push(`Midfielders (${totalCounts.MID}/5) exceed strict limits.`);
      if (totalCounts.FWD > 3) errors.push(`Forwards (${totalCounts.FWD}/3) exceed strict limits.`);
    }

    setValidationErrors(errors);
  };

  const handlePlayerPress = async (rosterId: string) => {
    if (!swappingPlayerId) {
      setSwappingPlayerId(rosterId);
      return;
    }

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

    // 🧤 Goalkeepers can only swap with Goalkeepers
    const isPlayerAGk = playerA.players?.element_type === 'GKP';
    const isPlayerBGk = playerB.players?.element_type === 'GKP';

    if ((isPlayerAGk || isPlayerBGk) && !(isPlayerAGk && isPlayerBGk)) {
      Alert.alert("Position Locked", "Goalkeepers can only be swapped with another Goalkeeper.");
      setSwappingPlayerId(null);
      return;
    }

    // Bench-to-bench reordering
    if (!playerA.is_starting && !playerB.is_starting) {
      try {
        setLoading(true);
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

    // Substitution Formation Validation
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

  const defCount = startersList.filter(s => s.players?.element_type === 'DEF').length;
  const midCount = startersList.filter(s => s.players?.element_type === 'MID').length;
  const fwdCount = startersList.filter(s => s.players?.element_type === 'FWD').length;

  const renderPlayerBadge = (item: RosterItem, overrideBenchIndex?: number) => {
    const isSelected = swappingPlayerId === item.id;
    let priorityTag = item.players?.element_type || '';
    
    if (!item.is_starting) {
      if (item.players?.element_type === 'GKP') {
        priorityTag = 'GK Sub';
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
      {/* FORMATION & ROSTER TYPE BADGE */}
      <View style={styles.formationBar}>
        <Text style={styles.formationText}>
          FORMATION: {defCount}-{midCount}-{fwdCount} • {rosterType} ROSTER
        </Text>
      </View>

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

          {/* STARTING XI ON PITCH */}
          <View style={styles.pitchRow}>
            {startersList.filter(s => s.players?.element_type === 'FWD').map(p => renderPlayerBadge(p))}
          </View>
          <View style={styles.pitchRow}>
            {startersList.filter(s => s.players?.element_type === 'MID').map(p => renderPlayerBadge(p))}
          </View>
          <View style={styles.pitchRow}>
            {startersList.filter(s => s.players?.element_type === 'DEF').map(p => renderPlayerBadge(p))}
          </View>
          <View style={styles.pitchRow}>
            {startersList.filter(s => s.players?.element_type === 'GKP').map(p => renderPlayerBadge(p))}
          </View>
        </View>

        <Text style={styles.benchHeader}>SUBSTITUTES BENCH (LEFT-TO-RIGHT AUTO-SUB PRIORITY)</Text>
        
        {/* BENCH CONTAINER (GK SUB + OUTFIELD SUBS 1, 2, 3) */}
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
  formationBar: { backgroundColor: '#111', paddingVertical: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#222', alignItems: 'center' },
  formationText: { color: '#00ff87', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
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
  benchHeader: { fontSize: 10, fontWeight: '900', color: '#888', textTransform: 'uppercase', marginLeft: 16, marginTop: 10, letterSpacing: 0.5 },
  benchContainer: { flexDirection: 'row', backgroundColor: '#111', margin: 12, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: '#222', minHeight: 95, alignItems: 'center', justifyContent: 'center' },
  benchGroupSection: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  benchDivider: { width: 2, height: 45, backgroundColor: '#00ff8755', marginHorizontal: 10, borderRadius: 1 },
  emptyBenchText: { color: '#444', fontSize: 12, width: '100%', textAlign: 'center', fontWeight: '600' },
});