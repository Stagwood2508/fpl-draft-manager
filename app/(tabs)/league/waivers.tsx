import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '@/utils/supabase';

export default function WaiverTestCenterScreen({ leagueId: propLeagueId, gameweek = 1 }: { leagueId?: string; gameweek?: number }) {
  const [loading, setLoading] = useState(false);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(propLeagueId || null);
  const [waiverDeadline, setWaiverDeadline] = useState<string | null>(null);
  const [gwDeadline, setGwDeadline] = useState<string | null>(null);
  const [pendingClaims, setPendingClaims] = useState<any[]>([]);

  // 1. Auto-resolve Active League ID if not explicitly passed
  useEffect(() => {
    const resolveLeagueContext = async () => {
      if (propLeagueId) {
        setActiveLeagueId(propLeagueId);
        return;
      }
      try {
        const { data: memberData, error: memberErr } = await supabase
          .from('league_members')
          .select('league_id')
          .limit(1)
          .single();

        if (memberErr || !memberData) {
          console.error('[WAIVERS] Active league membership not found');
          return;
        }
        console.log('[WAIVERS] Resolved League ID:', memberData.league_id);
        setActiveLeagueId(memberData.league_id);
      } catch (err) {
        console.error('[WAIVERS] Error resolving league ID:', err);
      }
    };

    resolveLeagueContext();
  }, [propLeagueId]);

  useEffect(() => {
    if (activeLeagueId) {
      loadGameweekDates();
    }
  }, [activeLeagueId, gameweek]);

  // 2. Set or load Gameweek & Waiver Deadlines
  const setupCustomGameweekDeadline = async (targetGwDate: Date) => {
    if (!activeLeagueId) {
      Alert.alert('Context Error', 'No active league ID found. Please check your league membership.');
      return;
    }

    try {
      setLoading(true);
      const gwLockTime = targetGwDate.toISOString();
      // Waiver deadline = GW Deadline minus 24 hours
      const waiverLockTime = new Date(targetGwDate.getTime() - 24 * 60 * 60 * 1000).toISOString();

      console.log(`[WAIVERS] Upserting deadlines for league: ${activeLeagueId}, GW: ${gameweek}`);

      const { error } = await supabase.from('league_gameweeks').upsert({
        league_id: activeLeagueId,
        gameweek: gameweek,
        gw_deadline: gwLockTime,
        waiver_deadline: waiverLockTime,
        is_waiver_processed: false
      }, { onConflict: 'league_id,gameweek' });

      if (error) throw error;

      setGwDeadline(gwLockTime);
      setWaiverDeadline(waiverLockTime);
      Alert.alert('Deadline Set', `GW${gameweek} locked. Waivers process 24h prior.`);
    } catch (err: any) {
      console.error('[WAIVERS] Upsert Error:', err);
      Alert.alert('RLS / Database Error', err.message);
    } finally {
      setLoading(false);
    }
  };

const loadGameweekDates = async () => {
  if (!activeLeagueId) return;

  // 1. Fetch Gameweek Deadlines
  const { data } = await supabase
    .from('league_gameweeks')
    .select('*')
    .eq('league_id', activeLeagueId)
    .eq('gameweek', gameweek)
    .maybeSingle();

  if (data) {
    setGwDeadline(data.gw_deadline);
    setWaiverDeadline(data.waiver_deadline);
  }

  // 2. Fetch All Pending Claims for the League (No gameweek filter!)
  const { data: claims, error: claimsErr } = await supabase
    .from('waiver_claims')
    .select(`
      id,
      status,
      user_id,
      priority_order,
      players:player_to_add ( web_name )
    `)
    .eq('league_id', activeLeagueId)
    .ilike('status', 'pending'); // Case-insensitive catch for 'pending' or 'PENDING'

  if (claimsErr) {
    console.error('[WAIVERS] Error fetching claims:', claimsErr);
  } else {
    console.log('[WAIVERS] Fetched pending claims:', claims);
    setPendingClaims(claims || []);
  }
};

  // 3. Trigger Waiver Process Execution
  const handleExecuteWaiverBatch = async () => {
    if (!activeLeagueId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('process_league_waivers', {
        p_league_id: activeLeagueId,
        p_gameweek: gameweek
      });

      if (error) throw error;
      Alert.alert('Waivers Processed!', data.message);
      loadGameweekDates();
    } catch (err: any) {
      Alert.alert('Waiver Engine Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>GW {gameweek} Waiver Control Center</Text>

      <View style={styles.card}>
        <Text style={styles.label}>LEAGUE ID CONTEXT:</Text>
        <Text style={styles.valText}>{activeLeagueId || 'Resolving...'}</Text>

        <Text style={[styles.label, { marginTop: 10 }]}>GAMEWEEK DEADLINE:</Text>
        <Text style={styles.valText}>{gwDeadline ? new Date(gwDeadline).toLocaleString() : 'Not Set'}</Text>

        <Text style={[styles.label, { marginTop: 10 }]}>WAIVER DEADLINE (24H PRIOR):</Text>
        <Text style={styles.valGreen}>{waiverDeadline ? new Date(waiverDeadline).toLocaleString() : 'Not Set'}</Text>
      </View>

      <TouchableOpacity 
        style={[styles.btnPrimary, !activeLeagueId && styles.btnDisabled]} 
        disabled={!activeLeagueId || loading}
        onPress={() => {
          // Set GW deadline to 48 hours from now
          const testDate = new Date(Date.now() + 48 * 60 * 60 * 1000);
          setupCustomGameweekDeadline(testDate);
        }}
      >
        <Text style={styles.btnText}>📅 SET GW DEADLINE (48H FROM NOW)</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.label}>PENDING CLAIMS QUEUE: {pendingClaims.length}</Text>
        {pendingClaims.map((c, i) => (
          <Text key={i} style={styles.claimItem}>
            #{i + 1} - Target: {c.players?.web_name || c.player_to_add} ({c.status})
          </Text>
        ))}
      </View>

      <TouchableOpacity 
        style={[styles.btnPrimary, { backgroundColor: '#FF9500' }, !activeLeagueId && styles.btnDisabled]} 
        onPress={handleExecuteWaiverBatch}
        disabled={!activeLeagueId || loading}
      >
        {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.btnText}>⚙️ TEST RUN WAIVER PROCESSING</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#0A0A0A', flex: 1 },
  headerTitle: { color: '#FFF', fontSize: 16, fontWeight: '900', marginBottom: 12 },
  card: { backgroundColor: '#111', padding: 14, borderRadius: 4, borderWidth: 1, borderColor: '#222', marginBottom: 12 },
  label: { color: '#666', fontSize: 10, fontWeight: '800' },
  valText: { color: '#FFF', fontSize: 12, fontWeight: '700', marginTop: 2 },
  valGreen: { color: '#00ff87', fontSize: 12, fontWeight: '900', marginTop: 2 },
  claimItem: { color: '#AAA', fontSize: 12, marginTop: 4, fontWeight: '600' },
  btnPrimary: { backgroundColor: '#00ff87', padding: 14, borderRadius: 4, alignItems: 'center', marginBottom: 12 },
  btnDisabled: { opacity: 0.3 },
  btnText: { color: '#000', fontWeight: '900', fontSize: 12 }
});