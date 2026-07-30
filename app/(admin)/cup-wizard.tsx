import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '@/utils/supabase';

type TournamentFormat = 'PURE' | 'TWO_LEG' | 'GROUP_KO' | 'EXECUTIONER' | 'DOUBLE_ELIM';
type SeedingMethod = 'RANDOM' | 'RANK_WEIGHTED';
type TieBreaker = 'HIGHEST_PLAYER' | 'LOWEST_BENCH' | 'MOST_GOALS' | 'CAPTAIN_SCORE';

export default function CupWizardScreen() {
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [leagueId, setLeagueId] = useState<string | null>(null);

  // --- CORE STATE ENGINE ---
  const [cupName, setCupName] = useState('');
  const [startGameweek, setStartGameweek] = useState('GW1');
  const [duration, setDuration] = useState('5');
  const [format, setFormat] = useState<TournamentFormat>('PURE');

  // Format Specific Modifiers
  const [executionerCount, setExecutionerCount] = useState('1');
  const [grandFinalReset, setGrandFinalReset] = useState(true);

  // Qualification Gates
  const [fieldSize, setFieldSize] = useState('ALL');
  const [seedingMethod, setSeedingMethod] = useState<SeedingMethod>('RANDOM');

  // Tie-Breaker Priority Matrix (Ordered Array State)
  const [tieBreakers, setTieBreakers] = useState<TieBreaker[]>([
    'HIGHEST_PLAYER',
    'LOWEST_BENCH',
    'MOST_GOALS',
    'CAPTAIN_SCORE'
  ]);

  // Virtual Reward Pool
  const [winnerPrize, setWinnerPrize] = useState('');
  const [runnerUpPrize, setRunnerUpPrize] = useState('');
  const [thirdPlacePlayoff, setThirdPlacePlayoff] = useState(false);

  useEffect(() => {
    if (isFocused) {
      fetchCurrentLeagueContext();
    }
  }, [isFocused]);

  const fetchCurrentLeagueContext = async () => {
    try {
      setLoading(true);
      const { data: memberData, error } = await supabase
        .from('league_members')
        .select('league_id')
        .limit(1)
        .single();

      if (error || !memberData) throw new Error('Could not identify a clear active league contextual frame.');
      setLeagueId(memberData.league_id);
    } catch (err: any) {
      Alert.alert('Context Engine Offline', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Draggable-alternative Matrix Priority Tweak Array Mutators
  const shiftTieBreaker = (index: number, direction: 'UP' | 'DOWN') => {
    const nextMatrix = [...tieBreakers];
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= nextMatrix.length) return;
    
    const temp = nextMatrix[index];
    nextMatrix[index] = nextMatrix[targetIndex];
    nextMatrix[targetIndex] = temp;
    setTieBreakers(nextMatrix);
  };

  const formatLabels: Record<TournamentFormat, string> = {
    PURE: 'Pure Knockout (Single)',
    TWO_LEG: 'Two-Legged Aggregates',
    GROUP_KO: 'Group into Knockout',
    EXECUTIONER: 'Executioner Style Pool',
    DOUBLE_ELIM: 'Double Elimination'
  };

  const tieBreakerLabels: Record<TieBreaker, string> = {
    HIGHEST_PLAYER: 'Highest Scoring Single Player on Active Pitch Layout',
    LOWEST_BENCH: 'Lowest Bench Points Left Behind',
    MOST_GOALS: 'Most Goals Scored by Active Starting XI',
    CAPTAIN_SCORE: 'Sudden Death (Highest GW Captain Score)'
  };

  // --- AUTOMATIC SEEDING & TRANSACTION ENGINE ---
  const generateMasterTournamentStructure = async () => {
    if (!cupName.trim()) {
      Alert.alert('Validation Error', 'Tournament engine requires a valid Cup Identity configuration string.');
      return;
    }
    if (!leagueId) return;

    try {
      setProcessing(true);

      // 1. Fetch entries from league_members
      const { data: managers, error: managerFetchError } = await supabase
        .from('league_members')
        .select('user_id');

      if (managerFetchError || !managers || managers.length < 2) {
        throw new Error('Tournament construction aborted: Insufficient league entry sizes detected (Minimum 2 required).');
      }

      // Filter field size limits if constraint is numerical
      let qualifiedManagers = managers.map(m => m.user_id);
      if (fieldSize !== 'ALL') {
        const limit = parseInt(fieldSize, 10);
        qualifiedManagers = qualifiedManagers.slice(0, limit);
      }

      // 2. Commit Cup Configurations Envelope Meta Record
      const { data: cupConfig, error: configError } = await supabase
        .from('cup_configurations')
        .insert({
          league_id: leagueId,
          name: cupName,
          format,
          start_gameweek: startGameweek,
          duration_gw: parseInt(duration, 10),
          executioner_count_per_gw: format === 'EXECUTIONER' ? parseInt(executionerCount, 10) : null,
          double_elim_grand_reset: format === 'DOUBLE_ELIM' ? grandFinalReset : null,
          seeding_method: format === 'EXECUTIONER' ? 'POOL' : seedingMethod,
          tie_breaker_priority: tieBreakers,
          virtual_rewards: { winner: winnerPrize, runner_up: runnerUpPrize, third_place: thirdPlacePlayoff }
        })
        .select()
        .single();

      if (configError) throw configError;

      // 3. Bracket Generation Seeding Algorithm Logic
      // Executioner mode constructs a single tracking block layout rather than pairs
      if (format === 'EXECUTIONER') {
        const executionerFixtures = qualifiedManagers.map(managerId => ({
          cup_id: cupConfig.id,
          gameweek: startGameweek,
          home_user_id: managerId,
          away_user_id: null, // Pool format does not require binary matchup tracking
          cup_bracket_type: 'EXECUTIONER_POOL'
        }));

        const { error: poolInsertError } = await supabase.from('tournament_fixtures').insert(executionerFixtures);
        if (poolInsertError) throw poolInsertError;

      } else {
        // Handle bracket pairing arrays (Random draw vs sequential weight indexing)
        let pool = [...qualifiedManagers];
        if (seedingMethod === 'RANDOM') {
  pool.sort(() => Math.random() - 0.5);
}

        const generatedMatchups = [];
        const totalMatches = Math.floor(pool.length / 2);

        for (let i = 0; i < totalMatches; i++) {
          // Standard bracket scheduling map rules: 1st vs last (if weighted) else indexed pairs
          const homeIndex = i;
          const awayIndex = seedingMethod === 'RANK_WEIGHTED' ? pool.length - 1 - i : i + totalMatches;

          if (pool[homeIndex] && pool[awayIndex]) {
            generatedMatchups.push({
              cup_id: cupConfig.id,
              gameweek: startGameweek,
              home_user_id: pool[homeIndex],
              away_user_id: pool[awayIndex],
              cup_bracket_type: format === 'DOUBLE_ELIM' ? 'WINNERS_BRACKET' : 'OPENING_ROUND'
            });
          }
        }

        if (generatedMatchups.length > 0) {
          const { error: fixtureInsertError } = await supabase.from('tournament_fixtures').insert(generatedMatchups);
          if (fixtureInsertError) throw fixtureInsertError;
        }
      }

      Alert.alert('Execution Success', 'Master Tournament Pipeline compiled and successfully mapped to table architectures.');
    } catch (err: any) {
      Alert.alert('Transaction Aborted', err.message || 'Database pipeline mapping collision occurred.');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00ff87" />
      </View>
    );
  }

  const isExecutioner = format === 'EXECUTIONER';
  const isDoubleElim = format === 'DOUBLE_ELIM';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Tournament Engine Console</Text>
      <Text style={styles.subtitle}>Provision Knockout Competitions & Rulesets</Text>

      {/* SECTION 1: CORE IDENTITY & WINDOW */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Core Identity & Temporal Window</Text>
        
        <Text style={styles.label}>Cup Title Label</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., The Horsemen Devastation Trophy"
          placeholderTextColor="#444"
          value={cupName}
          onChangeText={setCupName}
        />

        <View style={styles.row}>
          <View style={{ width: '48%' }}>
            <Text style={styles.label}>Launch Gameweek</Text>
            <TextInput
              style={styles.input}
              value={startGameweek}
              onChangeText={setStartGameweek}
              placeholder="GW1"
              placeholderTextColor="#444"
            />
          </View>
          <View style={{ width: '48%' }}>
            <Text style={styles.label}>Duration (GWs)</Text>
            <TextInput
              style={styles.input}
              value={duration}
              onChangeText={setDuration}
              keyboardType="numeric"
              placeholder="5"
              placeholderTextColor="#444"
            />
          </View>
        </View>
      </View>

      {/* SECTION 2: FORMAT SELECTION STRATEGY */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Tournament Structural Format</Text>
        <View style={styles.segmentContainer}>
          {(['PURE', 'TWO_LEG', 'GROUP_KO', 'EXECUTIONER', 'DOUBLE_ELIM'] as const).map((fmt) => (
            <TouchableOpacity
              key={fmt}
              style={[styles.segmentBtn, format === fmt && styles.segmentBtnActive]}
              onPress={() => setFormat(fmt)}
            >
              <Text style={[styles.segmentText, format === fmt && styles.segmentTextActive]}>
                {formatLabels[fmt]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Dynamic Condition Panels */}
        {isExecutioner && (
          <View style={styles.dynamicSubPanel}>
            <Text style={styles.label}>Execution Strategy: Managers Eliminated Per GW</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={executionerCount}
              onChangeText={setExecutionerCount}
            />
          </View>
        )}

        {isDoubleElim && (
          <View style={styles.toggleRow}>
            <View style={{ width: '75%' }}>
              <Text style={styles.toggleTitle}>Grand Final Bracket Reset Advantage</Text>
              <Text style={styles.toggleSub}>Winners bracket champion must be defeated twice in final showdown.</Text>
            </View>
            <Switch
              value={grandFinalReset}
              onValueChange={setGrandFinalReset}
              trackColor={{ false: '#222', true: '#00ff87' }}
              thumbColor="#fff"
            />
          </View>
        )}
      </View>

      {/* SECTION 3: ENTRY GATES & SEEDING */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Qualification & Entry Gates</Text>

        <Text style={styles.label}>Field Size Restraints</Text>
        <View style={styles.row}>
          {['ALL', '4', '8', '16'].map(size => (
            <TouchableOpacity
              key={size}
              style={[styles.miniBtn, fieldSize === size && styles.miniBtnActive]}
              onPress={() => setFieldSize(size)}
            >
              <Text style={[styles.miniBtnText, fieldSize === size && styles.miniBtnTextActive]}>
                {size === 'ALL' ? 'All Members' : `Top ${size}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, isExecutioner && { color: '#333' }]}>Bracket Seeding Methodology</Text>
        <View style={[styles.row, isExecutioner && { opacity: 0.3 }]} pointerEvents={isExecutioner ? 'none' : 'auto'}>
          <TouchableOpacity
            style={[styles.halfBtn, seedingMethod === 'RANDOM' && styles.halfBtnActive]}
            onPress={() => setSeedingMethod('RANDOM')}
          >
            <Text style={[styles.halfBtnText, seedingMethod === 'RANDOM' && styles.halfBtnTextActive]}>
              Random Draw Shuffle
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.halfBtn, seedingMethod === 'RANK_WEIGHTED' && styles.halfBtnActive]}
            onPress={() => setSeedingMethod('RANK_WEIGHTED')}
          >
            <Text style={[styles.halfBtnText, seedingMethod === 'RANK_WEIGHTED' && styles.halfBtnTextActive]}>
              Standings Weighting (1v16)
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* SECTION 4: ADVANCED TIE-BREAKER MATRIX */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Tie-Breaker Priority Matrix</Text>
        <Text style={styles.toggleSub}>Order operational rules parameters from peak to low priority values.</Text>
        
        {tieBreakers.map((matrixKey, index) => (
          <View key={matrixKey} style={styles.matrixRow}>
            <Text style={styles.matrixIndex}>#{index + 1}</Text>
            <Text style={styles.matrixLabel}>{tieBreakerLabels[matrixKey]}</Text>
            <View style={styles.matrixActions}>
              <TouchableOpacity style={styles.arrowBtn} onPress={() => shiftTieBreaker(index, 'UP')}>
                <Text style={styles.arrowText}>▲</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.arrowBtn} onPress={() => shiftTieBreaker(index, 'DOWN')}>
                <Text style={styles.arrowText}>▼</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* SECTION 5: VIRTUAL REWARDS ENGINE */}
      <View style={styles.card}>
        <Text style={styles.sectionHeader}>Virtual Reward & Prize Distribution Pool</Text>
        
        <Text style={styles.label}>Champion Custom App Trophy / Flag Allocator</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., GOLDEN_CUP_2026"
          placeholderTextColor="#444"
          value={winnerPrize}
          onChangeText={setWinnerPrize}
        />

        <Text style={styles.label}>Runner-Up Allocation Asset Flag</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., SILVER_MEDAL"
          placeholderTextColor="#444"
          value={runnerUpPrize}
          onChangeText={setRunnerUpPrize}
        />

        <View style={styles.toggleRow}>
          <View style={{ width: '75%' }}>
            <Text style={styles.toggleTitle}>Include Third-Place Playoff</Text>
            <Text style={styles.toggleSub}>Generates additional bracket mapping assets for semi-final survivors.</Text>
          </View>
          <Switch
            value={thirdPlacePlayoff}
            onValueChange={setThirdPlacePlayoff}
            trackColor={{ false: '#222', true: '#00ff87' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* SUBMIT COMPILATION EXECUTION RUNNER */}
      <TouchableOpacity
        style={styles.compileBtn}
        onPress={generateMasterTournamentStructure}
        disabled={processing}
      >
        {processing ? (
          <ActivityIndicator size="small" color="#000" />
        ) : (
          <Text style={styles.compileBtnText}>GENERATE MASTER TOURNAMENT STRUCTURE</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  content: { padding: 16, paddingBottom: 50 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
  title: { fontSize: 24, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', letterSpacing: 1 },
  subtitle: { fontSize: 13, color: '#00ff87', marginBottom: 20, fontWeight: '600' },
  card: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 4, padding: 14, marginBottom: 16 },
  sectionHeader: { fontSize: 14, fontWeight: '800', color: '#FFF', textTransform: 'uppercase', marginBottom: 14, borderBottomWidth: 1, borderBottomColor: '#222', paddingBottom: 6, letterSpacing: 0.5 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase', fontWeight: '700', marginBottom: 6, marginTop: 10 },
  input: { backgroundColor: '#000', borderWidth: 1, borderColor: '#333', color: '#FFF', padding: 12, borderRadius: 2, fontSize: 14, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  segmentContainer: { marginTop: 4 },
  segmentBtn: { backgroundColor: '#000', borderLeftWidth: 2, borderLeftColor: '#333', padding: 12, marginBottom: 6 },
  segmentBtnActive: { borderLeftColor: '#00ff87', backgroundColor: '#14251c' },
  segmentText: { color: '#666', fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: '#00ff87', fontWeight: '800' },
  dynamicSubPanel: { marginTop: 10, borderLeftWidth: 1, borderLeftColor: '#00ff87', paddingLeft: 12 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, backgroundColor: '#000', padding: 10, borderWidth: 1, borderColor: '#222' },
  toggleTitle: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  toggleSub: { color: '#555', fontSize: 11, marginTop: 2 },
  miniBtn: { flex: 1, backgroundColor: '#000', borderWidth: 1, borderColor: '#222', padding: 10, alignItems: 'center', marginHorizontal: 2 },
  miniBtnActive: { borderColor: '#00ff87', backgroundColor: '#14251c' },
  miniBtnText: { color: '#555', fontSize: 12, fontWeight: '600' },
  miniBtnTextActive: { color: '#00ff87', fontWeight: '700' },
  halfBtn: { width: '49%', backgroundColor: '#000', borderWidth: 1, borderColor: '#222', padding: 12, alignItems: 'center' },
  halfBtnActive: { borderColor: '#00ff87', backgroundColor: '#14251c' },
  halfBtnText: { color: '#555', fontSize: 12, fontWeight: '600' },
  halfBtnTextActive: { color: '#00ff87', fontWeight: '700' },
  matrixRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#000', borderWidth: 1, borderColor: '#222', padding: 10, marginBottom: 6, borderRadius: 2 },
  matrixIndex: { color: '#00ff87', fontWeight: '900', width: '10%', fontSize: 14 },
  matrixLabel: { color: '#CCC', width: '70%', fontSize: 12, fontWeight: '500', paddingRight: 4 },
  matrixActions: { width: '20%', flexDirection: 'row', justifyContent: 'space-between' },
  arrowBtn: { backgroundColor: '#111', borderWidth: 1, borderColor: '#333', padding: 6, borderRadius: 2, width: '46%', alignItems: 'center' },
  arrowText: { color: '#888', fontSize: 10 },
  compileBtn: { backgroundColor: '#00ff87', padding: 16, alignItems: 'center', borderRadius: 2, marginTop: 10, borderWidth: 1, borderColor: '#00ff87' },
  compileBtnText: { color: '#000', fontWeight: '900', fontSize: 14, letterSpacing: 0.5 }
});